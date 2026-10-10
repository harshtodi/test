/**
 * Delivers files from the host (CLI, second instance, macOS open-file, drag
 * onto the dock icon) to the renderer, queueing them until the preload has
 * reported `renderer:ready`.
 */
import type { BrowserWindow, WebContents } from 'electron';
import { readOpenedFiles } from './files';
import { IPC } from './types';
import type { OpenedFile } from './types';

export class FileOpener {
  private pending: OpenedFile[] = [];
  private ready = false;
  private window: BrowserWindow | null = null;
  /** Paths requested before a window existed (macOS open-file at launch). */
  private pendingPaths: string[] = [];
  private readonly onFailure: (messages: string[]) => void;

  constructor(onFailure: (messages: string[]) => void = (m) => console.error('[open]', m.join('\n'))) {
    this.onFailure = onFailure;
  }

  /** Bind the opener to the window that should receive files. */
  attach(win: BrowserWindow): void {
    this.window = win;
    this.ready = false;
    // A reload (dev menu) drops the renderer's listeners: wait for the next renderer:ready.
    win.webContents.on('did-start-loading', () => {
      if (this.window === win) this.ready = false;
    });
    win.on('closed', () => {
      if (this.window === win) {
        this.window = null;
        this.ready = false;
      }
    });
    if (this.pendingPaths.length) {
      const paths = this.pendingPaths;
      this.pendingPaths = [];
      void this.openPaths(paths);
    }
  }

  get hasWindow(): boolean {
    return this.window !== null && !this.window.isDestroyed();
  }

  /** Called when the preload of `sender` has installed the bridge. */
  markReady(sender: WebContents): void {
    if (!this.window || this.window.isDestroyed() || sender.id !== this.window.webContents.id) return;
    this.ready = true;
    this.flush();
  }

  /** Read the given paths and hand them to the renderer (or queue them). */
  async openPaths(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    if (!this.hasWindow) {
      this.pendingPaths.push(...paths);
      return;
    }
    const { files, failures } = await readOpenedFiles(paths);
    if (failures.length) this.onFailure(failures);
    if (files.length) this.deliver(files);
  }

  deliver(files: OpenedFile[]): void {
    this.pending.push(...files);
    this.flush();
  }

  private flush(): void {
    if (!this.ready || !this.window || this.window.isDestroyed() || this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    this.window.webContents.send(IPC.hostOpenFiles, batch);
    // Bring an already-shown window forward (second instance, Finder open-file);
    // never force a window that is still waiting for `ready-to-show` on screen.
    if (this.window.isMinimized()) this.window.restore();
    if (this.window.isVisible()) this.window.focus();
  }
}
