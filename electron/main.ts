/**
 * Electron main process.
 *
 * - Serves the production bundle from the privileged `app://pdf-editor/`
 *   scheme (dev: the Vite dev server given in VITE_DEV_SERVER_URL).
 * - One sandboxed, context-isolated window; new windows and external
 *   navigation are denied (http(s) links open in the system browser).
 * - Native open/save dialogs, unsaved-changes prompt, application menu.
 * - Files from the command line, a second instance or macOS `open-file` are
 *   read here and pushed to the renderer once it reports ready.
 *
 * Environment:
 *   VITE_DEV_SERVER_URL        dev mode: load this URL, open detached devtools.
 *   PDF_EDITOR_USER_DATA_DIR   override userData (used by the e2e smoke tests).
 */
import { BrowserWindow, app, dialog, session, shell } from 'electron';
import type { Event as ElectronEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { collectFilePaths } from './files';
import { clearDirty, isWindowDirty, registerIpc } from './ipc';
import { installApplicationMenu } from './menu';
import { FileOpener } from './opener';
import { APP_INDEX_URL, APP_ORIGIN, registerAppProtocol, registerAppSchemeAsPrivileged } from './protocol';
import { APP_BACKGROUND, APP_NAME, IPC } from './types';
import type { MenuCommand } from './types';
import { MIN_WINDOW_SIZE, loadWindowState, saveWindowState } from './window-state';

const devServerUrl = process.env.VITE_DEV_SERVER_URL?.trim() || '';
const isDev = devServerUrl.length > 0;
const distDir = path.join(__dirname, '../dist');
const preloadPath = path.join(__dirname, 'preload.cjs');

const userDataOverride = process.env.PDF_EDITOR_USER_DATA_DIR?.trim();
if (userDataOverride) app.setPath('userData', path.resolve(userDataOverride));

if (process.platform === 'win32') app.setAppUserModelId('com.harshtodi.pdfeditor');

// --- must happen before `ready` -------------------------------------------
registerAppSchemeAsPrivileged();
// Note: renderer sandboxing is enabled per window (`sandbox: true`). The
// global `app.enableSandbox()` would force `--enable-sandbox`, which overrides
// `--no-sandbox` and makes every child process abort when run as root (CI).

const opener = new FileOpener((failures) => {
  dialog.showErrorBox('Could not open files', failures.join('\n'));
});

let mainWindow: BrowserWindow | null = null;
/** Windows the user chose to close without saving. */
const forceClose = new WeakSet<BrowserWindow>();

// macOS: files opened via Finder / dock, possibly before `ready`.
app.on('open-file', (event, file) => {
  event.preventDefault();
  void opener.openPaths(collectFilePaths(['', file]));
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    const paths = collectFilePaths(argv, workingDirectory);
    const win = mainWindow ?? (app.isReady() ? createMainWindow() : null);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    void opener.openPaths(paths);
  });

  void app.whenReady().then(onReady);
}

function onReady(): void {
  registerAppProtocol(distDir);
  hardenSession();
  registerIpc(opener, isAllowedNavigation);
  installApplicationMenu({ isDev, sendCommand, showAbout });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });

  createMainWindow();
  void opener.openPaths(collectFilePaths(process.argv, process.cwd()));
}

function hardenSession(): void {
  const allowed = new Set(['clipboard-sanitized-write', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

function resolveWindowIcon(): string | undefined {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'icon.png'),
    path.join(__dirname, '../build/icon.png'),
  ];
  return candidates.find((p) => p && fs.existsSync(p));
}

function isAllowedNavigation(url: string): boolean {
  if (isDev) {
    try {
      return new URL(url).origin === new URL(devServerUrl).origin;
    } catch {
      return false;
    }
  }
  return url.startsWith(`${APP_ORIGIN}/`);
}

function openExternalIfWeb(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

export function createMainWindow(): BrowserWindow {
  const state = loadWindowState();
  const icon = process.platform === 'linux' ? resolveWindowIcon() : undefined;
  const win = new BrowserWindow({
    title: APP_NAME,
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    show: false,
    backgroundColor: APP_BACKGROUND,
    autoHideMenuBar: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: isDev,
    },
  });
  mainWindow = win;
  opener.attach(win);

  win.once('ready-to-show', () => {
    if (state.maximized) win.maximize();
    win.show();
  });

  // Keep the OS title bar fixed to the product name.
  win.on('page-title-updated', (event) => event.preventDefault());

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfWeb(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url)) return;
    event.preventDefault();
    openExternalIfWeb(url);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] process gone:', details.reason);
  });

  win.on('close', (event) => onWindowClose(win, event));
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  const url = isDev ? devServerUrl : APP_INDEX_URL;
  win.loadURL(url).catch((err: unknown) => reportLoadFailure(win, url, err));
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  return win;
}

/** A blank window is the worst failure mode: say what went wrong instead. */
function reportLoadFailure(win: BrowserWindow, url: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[main] could not load ${url}: ${message}`);
  if (win.isDestroyed()) return;
  const hint = isDev
    ? `Is the Vite dev server running at ${devServerUrl}? Start the app with \`npm run dev\`.`
    : `The renderer bundle was not found in ${distDir}. Run \`npm run build\` before \`npm start\`.`;
  win.show();
  dialog.showMessageBox(win, {
    type: 'error',
    title: APP_NAME,
    message: 'PDF Editor could not load its user interface',
    detail: `${hint}\n\n${message}`,
    buttons: ['Quit'],
  }).then(() => app.quit(), () => app.quit());
}

/** Unsaved-changes prompt. Runs for window close, Cmd+Q and app.quit(). */
function onWindowClose(win: BrowserWindow, event: ElectronEvent): void {
  if (forceClose.has(win) || !isWindowDirty(win)) {
    saveWindowState(win);
    return;
  }
  const choice = dialog.showMessageBoxSync(win, {
    type: 'warning',
    title: APP_NAME,
    message: 'You have unsaved changes',
    detail: 'Save your document before closing, or your changes will be lost.',
    buttons: ['Save…', "Don't save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (choice === 2) {
    // Cancel also aborts an in-flight app.quit() / Cmd+Q.
    event.preventDefault();
    return;
  }
  if (choice === 0) {
    // Keep the window open; the renderer shows the save dialog. The user
    // closes again once the save is done (the dirty flag is cleared then).
    event.preventDefault();
    sendCommandTo(win, 'save');
    return;
  }
  forceClose.add(win);
  clearDirty(win);
  saveWindowState(win);
}

function sendCommandTo(win: BrowserWindow, command: MenuCommand): void {
  if (!win.isDestroyed()) win.webContents.send(IPC.hostMenuCommand, command);
}

function sendCommand(command: MenuCommand): void {
  const target = BrowserWindow.getFocusedWindow() ?? mainWindow ?? BrowserWindow.getAllWindows()[0];
  if (target) sendCommandTo(target, command);
  else if (command === 'open' && app.isReady()) createMainWindow();
}

function showAbout(): void {
  const detail = [
    `Version ${app.getVersion()}`,
    `Electron ${process.versions.electron}`,
    `Chromium ${process.versions.chrome}`,
    `Node ${process.versions.node}`,
    `V8 ${process.versions.v8}`,
    `${process.platform} ${process.arch}`,
  ].join('\n');
  const options = { type: 'info' as const, title: `About ${APP_NAME}`, message: APP_NAME, detail, buttons: ['OK'] };
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
  void (win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
}
