/**
 * Main-process side of the preload bridge: native dialogs, file I/O and the
 * per-window "unsaved changes" flag.
 */
import { BrowserWindow, app, dialog, ipcMain } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { OPEN_DIALOG_FILTERS, SAVE_DIALOG_FILTERS, readOpenedFiles, sanitizeFileName } from './files';
import type { FileOpener } from './opener';
import { readPrefs, writePrefs } from './prefs';
import { IPC } from './types';
import type { OpenedFile, SaveResult } from './types';

/** webContents ids whose document has unsaved changes. */
const dirty = new Set<number>();

export function isWindowDirty(win: BrowserWindow): boolean {
  return !win.isDestroyed() && dirty.has(win.webContents.id);
}

export function clearDirty(win: BrowserWindow): void {
  if (!win.isDestroyed()) dirty.delete(win.webContents.id);
}

function defaultDirectory(): string {
  // preferences.json is user-editable: only trust a string naming an existing directory.
  const last = readPrefs().lastDir;
  if (typeof last === 'string' && last && isDirectory(last)) return last;
  try {
    return app.getPath('documents');
  } catch {
    return app.getPath('home');
  }
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Only the main frame of a page we loaded ourselves may drive the bridge.
 * (Electron's recommended check; see "Validate the sender of all IPC messages".)
 */
type TrustedUrlPredicate = (url: string) => boolean;
let isTrustedUrl: TrustedUrlPredicate = () => false;

function isTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null) return false;
  return isTrustedUrl(frame.url);
}

function rejectUntrusted(event: IpcMainInvokeEvent, channel: string): void {
  if (!isTrustedSender(event)) {
    console.warn(`[ipc] rejected ${channel} from ${event.senderFrame?.url ?? 'unknown frame'}`);
    throw new Error(`Untrusted sender for ${channel}`);
  }
}

function rememberDirectory(file: string): void {
  writePrefs({ lastDir: path.dirname(file) });
}

function windowOf(event: IpcMainInvokeEvent | IpcMainEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

async function handleOpenFiles(event: IpcMainInvokeEvent): Promise<OpenedFile[] | null> {
  rejectUntrusted(event, IPC.openFiles);
  const win = windowOf(event);
  const options = {
    title: 'Open files',
    defaultPath: defaultDirectory(),
    properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
    filters: [...OPEN_DIALOG_FILTERS],
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  const first = result.filePaths[0];
  if (first) rememberDirectory(first);
  const { files, failures } = await readOpenedFiles(result.filePaths);
  if (failures.length) {
    const box = {
      type: 'error' as const,
      title: 'Could not open files',
      message: failures.length === 1 ? 'One file could not be read.' : `${failures.length} files could not be read.`,
      detail: failures.join('\n'),
    };
    void (win ? dialog.showMessageBox(win, box) : dialog.showMessageBox(box));
  }
  return files;
}

async function handleSaveFile(event: IpcMainInvokeEvent, bytes: unknown, suggestedName: unknown): Promise<SaveResult> {
  rejectUntrusted(event, IPC.saveFile);
  if (!(bytes instanceof Uint8Array)) throw new TypeError('saveFile expects a Uint8Array');
  if (bytes.byteLength === 0) throw new TypeError('saveFile refuses to write an empty file');
  const win = windowOf(event);
  const options = {
    title: 'Save PDF',
    defaultPath: path.join(defaultDirectory(), sanitizeFileName(suggestedName)),
    filters: [...SAVE_DIALOG_FILTERS],
    properties: ['createDirectory', 'showOverwriteConfirmation'] as Array<'createDirectory' | 'showOverwriteConfirmation'>,
  };
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return { saved: false };
  let filePath = result.filePath;
  if (!/\.pdf$/i.test(filePath)) filePath += '.pdf';
  await mkdir(path.dirname(filePath), { recursive: true });
  // Write a sibling and rename it over the target: writeFile truncates first,
  // so a failed write (disk full, drive unplugged) would otherwise destroy the
  // PDF the user is saving over. rename replaces atomically on POSIX and with
  // MOVEFILE_REPLACE_EXISTING on Windows; on failure the old file is untouched.
  const tmp = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, bytes);
    await rename(tmp, filePath);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  rememberDirectory(filePath);
  if (process.platform === 'darwin' && win) win.setRepresentedFilename(filePath);
  return { saved: true, location: filePath };
}

/**
 * Register every IPC handler. Call once, after app ready. `trustedUrl` says
 * which page URLs may talk to us (the app:// origin, or the dev server).
 */
export function registerIpc(opener: FileOpener, trustedUrl: TrustedUrlPredicate): void {
  isTrustedUrl = trustedUrl;
  ipcMain.handle(IPC.openFiles, handleOpenFiles);
  ipcMain.handle(IPC.saveFile, handleSaveFile);
  ipcMain.on(IPC.setDirty, (event, value: unknown) => {
    if (!isTrustedSender(event)) return;
    if (value === true) dirty.add(event.sender.id);
    else dirty.delete(event.sender.id);
    const win = windowOf(event);
    if (win && !win.isDestroyed()) win.setDocumentEdited(value === true);
  });
  ipcMain.on(IPC.rendererReady, (event) => {
    if (!isTrustedSender(event)) return;
    dirty.delete(event.sender.id);
    opener.markReady(event.sender);
  });
}
