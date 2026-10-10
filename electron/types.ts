/**
 * Types and channel names shared by the main process and the preload script.
 *
 * These mirror the renderer-side contract in `src/platform/index.ts`
 * (`ElectronBridge`, `MenuCommand`, `OpenedFile`, `SaveResult`). The electron
 * tsconfig has no DOM lib, so the shapes are duplicated here instead of being
 * imported; keep both files in sync.
 */

export type MenuCommand = 'open' | 'save' | 'undo' | 'redo' | 'zoom-in' | 'zoom-out' | 'zoom-reset';

export const MENU_COMMANDS: readonly MenuCommand[] = [
  'open',
  'save',
  'undo',
  'redo',
  'zoom-in',
  'zoom-out',
  'zoom-reset',
];

export interface OpenedFile {
  /** Base name of the file (no directory). */
  name: string;
  bytes: Uint8Array;
}

export interface SaveResult {
  saved: boolean;
  /** Absolute path of the written file when `saved` is true. */
  location?: string;
}

export interface Versions {
  electron: string;
  chrome: string;
  node: string;
}

/** IPC channel names. Renderer → main unless noted. */
export const IPC = {
  /** invoke → `OpenedFile[] | null` */
  openFiles: 'dialog:open-files',
  /** invoke(bytes, suggestedName) → `SaveResult` */
  saveFile: 'dialog:save-file',
  /** send(dirty: boolean) */
  setDirty: 'app:set-dirty',
  /** send() once the preload has installed the bridge */
  rendererReady: 'renderer:ready',
  /** main → renderer: `OpenedFile[]` */
  hostOpenFiles: 'host:open-files',
  /** main → renderer: `MenuCommand` */
  hostMenuCommand: 'host:menu-command',
} as const;

export const APP_NAME = 'PDF Editor';
/** Matches `--bg` in src/styles.css (light theme). */
export const APP_BACKGROUND = '#f3f4f6';
