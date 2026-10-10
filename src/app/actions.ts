import { useEditorStore } from '@/state/store';
import { prepareTextForExport } from '@/app/text-raster';
import { getPlatform } from '@/platform';
import type { OpenedFile } from '@/platform';
import { importFile } from '@/core/import';
import { exportPdf } from '@/core/export';
import { detectFileKind } from '@/core/pdf-utils';
import { convertImageToJpeg, convertImageToPng, jpegExifOrientation, needsConversion, pngName } from '@/app/image-convert';

/**
 * High-level document actions used by the toolbar, keyboard shortcuts, drop
 * zone and host menu. Kept out of components so they can be unit tested and
 * reused by every entry point.
 */

export const ACCEPTED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'];

export function isAcceptedFile(name: string, type?: string): boolean {
  const lower = name.toLowerCase();
  if (ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
  return type === 'application/pdf' || (type?.startsWith('image/') ?? false);
}

function isOpenedFile(f: File | OpenedFile): f is OpenedFile {
  return (f as OpenedFile).bytes instanceof Uint8Array;
}

// Imports run one batch at a time so pages land in the order the files were
// dropped, even when a large PDF is still parsing as the next drop arrives.
let importQueue: Promise<void> = Promise.resolve();

/** Import files (from drop, <input type=file>, or host) and append their pages. */
export function openFiles(files: Iterable<File | OpenedFile>, insertAt?: number): Promise<void> {
  const list = Array.from(files);
  const run = importQueue.then(() => importFiles(list, insertAt));
  importQueue = run.catch(() => undefined);
  return run;
}

async function importFiles(files: (File | OpenedFile)[], insertAt?: number): Promise<void> {
  if (files.length === 0) return;
  const store = useEditorStore.getState();
  store.setBusy('importing');
  let at = insertAt;
  const failures: string[] = [];
  try {
    for (const file of files) {
      let name = file.name;
      const type = isOpenedFile(file) ? undefined : file.type;
      if (!isAcceptedFile(name, type)) {
        failures.push(`${name}: unsupported file type`);
        continue;
      }
      try {
        let bytes = isOpenedFile(file) ? file.bytes : new Uint8Array(await file.arrayBuffer());
        if (needsConversion(name, type, bytes)) {
          bytes = await convertImageToPng(new Blob([bytes as BlobPart], { type: type || undefined }));
          name = pngName(name);
        } else if (detectFileKind(bytes, name) === 'jpeg' && jpegExifOrientation(bytes) !== 1) {
          // pdf-lib (and PDF viewers) ignore EXIF: bake the orientation into the pixels
          bytes = await convertImageToJpeg(new Blob([bytes as BlobPart], { type: 'image/jpeg' }));
        }
        const source = await importFile(name, bytes);
        const ids = useEditorStore.getState().addSource(source, at);
        if (at !== undefined) at += ids.length;
      } catch (err) {
        failures.push(`${name}: ${(err as Error).message}`);
      }
    }
  } finally {
    useEditorStore.getState().setBusy(null);
  }
  if (failures.length) useEditorStore.getState().notify('error', `Could not open ${failures.join('; ')}`);
}

/** Name of the window event the shortcuts layer fires for Ctrl/Cmd+O. */
export const OPEN_REQUEST_EVENT = 'pdf-editor:open-request';

export function requestOpenFiles(): void {
  window.dispatchEvent(new CustomEvent(OPEN_REQUEST_EVENT));
}

/** Open the host's native dialog when available, else trigger the provided fallback. */
export async function openFilesViaDialog(fallback: () => void): Promise<void> {
  const platform = getPlatform();
  if (platform.openFiles) {
    const files = await platform.openFiles();
    if (files && files.length) await openFiles(files);
    return;
  }
  fallback();
}

/**
 * Re-entrancy guard shared by the save actions: a second Ctrl+S while a save
 * is running must not produce a second file, and saving while files are still
 * importing would write a partial document.
 */
function saveBlocked(): boolean {
  const state = useEditorStore.getState();
  if (state.busy === 'saving') return true;
  if (state.busy === 'importing') {
    state.notify('info', 'Still importing files — try saving again in a moment.');
    return true;
  }
  return false;
}

function saveNotice(location: string, warnings: string[]): ['info' | 'error', string] {
  if (warnings.length === 0) return ['info', `Saved ${location}`];
  return ['error', `Saved ${location}, with warnings: ${warnings.join(' ')}`];
}

/** Export the working document and hand it to the platform to save. */
export async function saveDocument(): Promise<boolean> {
  const state = useEditorStore.getState();
  if (state.pages.length === 0) {
    state.notify('info', 'Nothing to save yet. Drop a PDF to get started.');
    return false;
  }
  if (saveBlocked()) return false;
  state.setBusy('saving');
  try {
    const warnings: string[] = [];
    const prepared = prepareTextForExport(state.pages);
    const bytes = await exportPdf(prepared.pages, state.sources, {
      title: state.outputName.replace(/\.pdf$/i, ''),
      warnings,
    });
    const result = await getPlatform().saveFile(bytes, state.outputName);
    if (result.saved) {
      useEditorStore.getState().markSaved();
      useEditorStore.getState().notify(...saveNotice(result.location ?? state.outputName, warnings));
    }
    return result.saved;
  } catch (err) {
    useEditorStore.getState().notify('error', `Save failed: ${(err as Error).message}`);
    return false;
  } finally {
    useEditorStore.getState().setBusy(null);
  }
}

/** Export only the selected pages (or the active page) to a separate file. */
export async function saveSelectedPages(): Promise<boolean> {
  const state = useEditorStore.getState();
  const ids = state.selectedPageIds.length ? state.selectedPageIds : state.activePageId ? [state.activePageId] : [];
  const pages = state.pages.filter((p) => ids.includes(p.id));
  if (pages.length === 0) {
    state.notify('info', 'Select one or more pages first.');
    return false;
  }
  if (saveBlocked()) return false;
  state.setBusy('saving');
  try {
    const name = state.outputName.replace(/\.pdf$/i, '') + `-pages.pdf`;
    const warnings: string[] = [];
    const prepared = prepareTextForExport(pages);
    const bytes = await exportPdf(prepared.pages, state.sources, { title: name.replace(/\.pdf$/i, ''), warnings });
    const result = await getPlatform().saveFile(bytes, name);
    if (result.saved) useEditorStore.getState().notify(...saveNotice(result.location ?? name, warnings));
    return result.saved;
  } catch (err) {
    useEditorStore.getState().notify('error', `Save failed: ${(err as Error).message}`);
    return false;
  } finally {
    useEditorStore.getState().setBusy(null);
  }
}
