/**
 * Files the OS hands us: command-line arguments, a second instance, macOS
 * `open-file` events and the native open dialog all end up here.
 */
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileFilter } from 'electron';
import type { OpenedFile } from './types';

/**
 * Extensions accepted from the command line / file associations / a second
 * instance: PDFs plus the image formats pdf-lib embeds natively.
 */
export const OPENABLE_EXTENSIONS: ReadonlySet<string> = new Set(['.pdf', '.png', '.jpg', '.jpeg']);

/** Images the renderer re-encodes to PNG before import (see src/app/image-convert.ts). */
const CONVERTIBLE_IMAGE_EXTENSIONS = ['webp', 'gif', 'bmp', 'avif'];
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', ...CONVERTIBLE_IMAGE_EXTENSIONS];

export const OPEN_DIALOG_FILTERS: readonly FileFilter[] = [
  { name: 'PDF documents and images', extensions: ['pdf', ...IMAGE_EXTENSIONS] },
  { name: 'PDF documents', extensions: ['pdf'] },
  { name: 'Images', extensions: IMAGE_EXTENSIONS },
  { name: 'All files', extensions: ['*'] },
];

export const SAVE_DIALOG_FILTERS: readonly FileFilter[] = [{ name: 'PDF', extensions: ['pdf'] }];

export function isOpenableFile(file: string): boolean {
  return OPENABLE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

/** Desktop launchers may pass `file://` URIs (Linux `%U`); turn them into paths. */
function toPath(arg: string, cwd: string): string | null {
  if (/^file:\/\//i.test(arg)) {
    try {
      return fileURLToPath(arg);
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(arg)) return null; // some other URL scheme
  return path.resolve(cwd, arg);
}

/**
 * Pick openable file paths out of an argv list. `argv[0]` (the executable) is
 * skipped, as are switches (`--foo`) and anything that is not an existing
 * regular file with a supported extension. Order is preserved, duplicates removed.
 */
export function collectFilePaths(argv: readonly string[], cwd: string = process.cwd()): string[] {
  const out: string[] = [];
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith('-')) continue;
    const full = toPath(arg, cwd);
    if (!full || !isOpenableFile(full)) continue;
    try {
      if (!fs.statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    if (!out.includes(full)) out.push(full);
  }
  return out;
}

export interface ReadFilesResult {
  files: OpenedFile[];
  /** Human-readable messages for files that could not be read. */
  failures: string[];
}

/** Read files from disk into `{ name, bytes }` records for the renderer. */
export async function readOpenedFiles(paths: readonly string[]): Promise<ReadFilesResult> {
  const files: OpenedFile[] = [];
  const failures: string[] = [];
  for (const file of paths) {
    try {
      const buf = await readFile(file);
      // Copy out of Node's Buffer pool so structured clone sends exactly these bytes.
      files.push({ name: path.basename(file), bytes: new Uint8Array(buf) });
    } catch (err) {
      failures.push(`${path.basename(file)}: ${(err as Error).message}`);
    }
  }
  return { files, failures };
}

/** Sanitize a renderer-provided file name for use in a save dialog. */
export function sanitizeFileName(name: unknown, fallback = 'document.pdf'): string {
  if (typeof name !== 'string') return fallback;
  let base = path.basename(name.replace(/[\\/]/g, '/')).trim();
  // Characters that are illegal on Windows (and awkward everywhere else).
  // eslint-disable-next-line no-control-regex
  base = base.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/^\.+$/, '');
  if (!base) return fallback;
  if (!/\.pdf$/i.test(base)) base += '.pdf';
  return base.length > 200 ? `${base.slice(0, 196)}.pdf` : base;
}
