/**
 * Platform abstraction: the renderer never touches Node/Electron APIs directly.
 * In Electron the preload script exposes `window.pdfEditor`; in a browser we
 * fall back to the File System Access API or a plain download.
 */

export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
}

export interface SaveResult {
  saved: boolean;
  /** File path (Electron) or file name (web) when saved. */
  location?: string;
}

export interface Platform {
  readonly isElectron: boolean;
  saveFile(bytes: Uint8Array, suggestedName: string): Promise<SaveResult>;
  /** Native open dialog when available; `null` means "use an <input type=file>". */
  openFiles: (() => Promise<OpenedFile[] | null>) | null;
  /** Register for files the host asks us to open (menu, file association, CLI). */
  onOpenFiles?: (handler: (files: OpenedFile[]) => void) => () => void;
  /** Register for host menu commands (save, undo, redo ...). */
  onMenuCommand?: (handler: (command: MenuCommand) => void) => () => void;
  /** Tell the host whether there are unsaved changes (for close confirmation). */
  setDirty?: (dirty: boolean) => void;
}

export type MenuCommand = 'open' | 'save' | 'undo' | 'redo' | 'zoom-in' | 'zoom-out' | 'zoom-reset';

/** Shape of the API exposed by electron/preload.ts via contextBridge. */
export interface ElectronBridge {
  saveFile(bytes: Uint8Array, suggestedName: string): Promise<SaveResult>;
  openFiles(): Promise<OpenedFile[] | null>;
  onOpenFiles(handler: (files: OpenedFile[]) => void): () => void;
  onMenuCommand(handler: (command: MenuCommand) => void): () => void;
  setDirty(dirty: boolean): void;
  readonly versions: { electron: string; chrome: string; node: string };
}

declare global {
  interface Window {
    pdfEditor?: ElectronBridge;
  }
}

function electronPlatform(bridge: ElectronBridge): Platform {
  return {
    isElectron: true,
    saveFile: (bytes, name) => bridge.saveFile(bytes, name),
    openFiles: () => bridge.openFiles(),
    onOpenFiles: (h) => bridge.onOpenFiles(h),
    onMenuCommand: (h) => bridge.onMenuCommand(h),
    setDirty: (d) => bridge.setDirty(d),
  };
}

interface FilePickerWindow extends Window {
  showSaveFilePicker?: (opts: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{ createWritable(): Promise<{ write(d: BufferSource | Blob): Promise<void>; close(): Promise<void> }> }>;
}

/** localStorage key; set to "download" to bypass the native save picker (used by e2e tests). */
export const SAVE_MODE_KEY = 'pdf-editor.save-mode';

function forceDownload(): boolean {
  try {
    return localStorage.getItem(SAVE_MODE_KEY) === 'download';
  } catch {
    return false;
  }
}

const webPlatform: Platform = {
  isElectron: false,
  openFiles: null,
  async saveFile(bytes, suggestedName) {
    const w = window as FilePickerWindow;
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    if (typeof w.showSaveFilePicker === 'function' && window.isSecureContext && !forceDownload()) {
      try {
        const handle = await w.showSaveFilePicker({
          suggestedName,
          types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return { saved: true, location: suggestedName };
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return { saved: false };
        // fall through to download
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { saved: true, location: suggestedName };
  },
};

export function getPlatform(): Platform {
  if (typeof window !== 'undefined' && window.pdfEditor) return electronPlatform(window.pdfEditor);
  return webPlatform;
}
