import { useEditorStore } from '@/state/store';
import { getPlatform } from '@/platform';
import type { OpenedFile } from '@/platform';
import { importFile } from '@/core/import';
import { exportPdf } from '@/core/export';
import { convertImageToPng, needsConversion, pngName } from '@/app/image-convert';

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

/** Import files (from drop, <input type=file>, or host) and append their pages. */
export async function openFiles(files: Iterable<File | OpenedFile>, insertAt?: number): Promise<void> {
  const store = useEditorStore.getState();
  let at = insertAt;
  const failures: string[] = [];
  for (const file of files) {
    let name = file.name;
    const type = isOpenedFile(file) ? undefined : file.type;
    if (!isAcceptedFile(name, type)) {
      failures.push(`${name}: unsupported file type`);
      continue;
    }
    try {
      let bytes = isOpenedFile(file) ? file.bytes : new Uint8Array(await file.arrayBuffer());
      if (needsConversion(name, type)) {
        bytes = await convertImageToPng(new Blob([bytes as BlobPart], { type: type || undefined }));
        name = pngName(name);
      }
      const source = await importFile(name, bytes);
      const ids = useEditorStore.getState().addSource(source, at);
      if (at !== undefined) at += ids.length;
    } catch (err) {
      failures.push(`${name}: ${(err as Error).message}`);
    }
  }
  if (failures.length) store.notify('error', `Could not open ${failures.join('; ')}`);
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

/** Export the working document and hand it to the platform to save. */
export async function saveDocument(): Promise<boolean> {
  const state = useEditorStore.getState();
  if (state.pages.length === 0) {
    state.notify('info', 'Nothing to save yet. Drop a PDF to get started.');
    return false;
  }
  try {
    const bytes = await exportPdf(state.pages, state.sources, { title: state.outputName.replace(/\.pdf$/i, '') });
    const result = await getPlatform().saveFile(bytes, state.outputName);
    if (result.saved) {
      useEditorStore.getState().markSaved();
      useEditorStore.getState().notify('info', `Saved ${result.location ?? state.outputName}`);
    }
    return result.saved;
  } catch (err) {
    useEditorStore.getState().notify('error', `Save failed: ${(err as Error).message}`);
    return false;
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
  try {
    const name = state.outputName.replace(/\.pdf$/i, '') + `-pages.pdf`;
    const bytes = await exportPdf(pages, state.sources, { title: name.replace(/\.pdf$/i, '') });
    const result = await getPlatform().saveFile(bytes, name);
    if (result.saved) useEditorStore.getState().notify('info', `Saved ${result.location ?? name}`);
    return result.saved;
  } catch (err) {
    useEditorStore.getState().notify('error', `Save failed: ${(err as Error).message}`);
    return false;
  }
}
