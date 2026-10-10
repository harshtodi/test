/**
 * Preload script: the only code that runs with access to `ipcRenderer`.
 *
 * It exposes a tiny typed bridge as `window.pdfEditor`, matching the
 * `ElectronBridge` interface in `src/platform/index.ts`. It runs in the
 * sandboxed renderer, so only the `electron` module may be imported here.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { IPC } from './types';
import type { MenuCommand, OpenedFile, SaveResult, Versions } from './types';

function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => {
    handler(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

// Files can arrive (command line, second instance, macOS open-file) before the
// React app has subscribed; hold them until the first subscriber appears.
let openFilesSubscribers = 0;
const bufferedFiles: OpenedFile[][] = [];
ipcRenderer.on(IPC.hostOpenFiles, (_event: IpcRendererEvent, files: OpenedFile[]) => {
  if (openFilesSubscribers === 0) bufferedFiles.push(files);
});

const versions: Versions = {
  electron: process.versions.electron ?? '',
  chrome: process.versions.chrome ?? '',
  node: process.versions.node ?? '',
};

/** Must stay structurally identical to `ElectronBridge` (src/platform/index.ts). */
const bridge = {
  saveFile(bytes: Uint8Array, suggestedName: string): Promise<SaveResult> {
    return ipcRenderer.invoke(IPC.saveFile, bytes, suggestedName) as Promise<SaveResult>;
  },
  openFiles(): Promise<OpenedFile[] | null> {
    return ipcRenderer.invoke(IPC.openFiles) as Promise<OpenedFile[] | null>;
  },
  onOpenFiles(handler: (files: OpenedFile[]) => void): () => void {
    const off = subscribe<OpenedFile[]>(IPC.hostOpenFiles, handler);
    openFilesSubscribers++;
    if (bufferedFiles.length) {
      const batches = bufferedFiles.splice(0);
      queueMicrotask(() => {
        for (const batch of batches) handler(batch);
      });
    }
    return () => {
      openFilesSubscribers--;
      off();
    };
  },
  onMenuCommand(handler: (command: MenuCommand) => void): () => void {
    return subscribe<MenuCommand>(IPC.hostMenuCommand, handler);
  },
  setDirty(dirty: boolean): void {
    ipcRenderer.send(IPC.setDirty, dirty === true);
  },
  versions,
};

contextBridge.exposeInMainWorld('pdfEditor', bridge);

// Tell the main process it may now deliver files queued from the command line,
// a second instance or a macOS open-file event.
ipcRenderer.send(IPC.rendererReady);
