/**
 * pdf.js rendering helpers (browser only — not used by unit tests).
 *
 * - One pdf.js document per SourceDoc, cached by source id.
 * - `renderPageToCanvas` renders a PageRef at a given scale with the page's
 *   total rotation applied, so the canvas shows exactly what display-space
 *   annotations are measured against (see src/core/types.ts).
 * - `getThumbnailDataUrl` renders small previews through a queue and caches
 *   them, so reordering pages never re-renders.
 */
// The legacy build bundles the polyfills (e.g. Map.prototype.getOrInsertComputed)
// that the modern build expects from the engine; Chromium 141/142 (Playwright,
// Electron 39) do not have them yet, so the modern build fails to render.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist/legacy/build/pdf.mjs';
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker';
import type { PageGeometry, PageRef, SourceDoc, SourceId } from './types';
import { getPageGeometry } from './geometry';

/** Resolve a path under the app's base URL (works for Vite dev, GitHub Pages sub-paths and app://). */
function assetUrl(relative: string): string {
  return new URL(relative, document.baseURI).href;
}

let workerReady = false;
function ensureWorker(): void {
  if (workerReady) return;
  pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();
  workerReady = true;
}

const docCache = new Map<SourceId, Promise<PDFDocumentProxy>>();
const pageCache = new Map<string, Promise<PDFPageProxy>>();

export function loadPdfJsDocument(source: SourceDoc): Promise<PDFDocumentProxy> {
  let p = docCache.get(source.id);
  if (!p) {
    ensureWorker();
    // pdf.js takes ownership of (and may detach) the buffer: hand it a copy.
    const data = source.bytes.slice();
    p = pdfjsLib.getDocument({
      data,
      // standard 14 fonts and CJK CMaps are copied to public/pdfjs by scripts/copy-pdfjs-assets.mjs
      standardFontDataUrl: assetUrl('pdfjs/standard_fonts/'),
      cMapUrl: assetUrl('pdfjs/cmaps/'),
      cMapPacked: true,
    }).promise;
    p.catch(() => docCache.delete(source.id));
    docCache.set(source.id, p);
  }
  return p;
}

export function getPdfJsPage(source: SourceDoc, sourceIndex: number): Promise<PDFPageProxy> {
  const key = `${source.id}:${sourceIndex}`;
  let p = pageCache.get(key);
  if (!p) {
    p = loadPdfJsDocument(source).then((doc) => doc.getPage(sourceIndex + 1));
    p.catch(() => pageCache.delete(key));
    pageCache.set(key, p);
  }
  return p;
}

/**
 * Free what pdf.js keeps per rendered page (operator list, decoded images —
 * tens of MB for a scanned page) while keeping the page proxy cached. pdf.js
 * defers the cleanup by itself while a render of that page is still running,
 * so this is safe to call at any time; the next render re-fetches the data.
 */
export async function releasePage(source: SourceDoc, sourceIndex: number): Promise<void> {
  const p = pageCache.get(`${source.id}:${sourceIndex}`);
  if (!p) return;
  try {
    (await p).cleanup();
  } catch {
    /* ignore */
  }
}

/** Drop cached pdf.js objects for a source (call when a document is cleared). */
export async function releaseSource(sourceId: SourceId): Promise<void> {
  const p = docCache.get(sourceId);
  docCache.delete(sourceId);
  for (const key of [...pageCache.keys()]) if (key.startsWith(`${sourceId}:`)) pageCache.delete(key);
  if (p) {
    try {
      (await p).destroy();
    } catch {
      /* ignore */
    }
  }
}

export async function releaseAllSources(): Promise<void> {
  await Promise.all([...docCache.keys()].map(releaseSource));
  thumbCache.clear();
}

export interface RenderHandle {
  /** Resolves when rendering finished or was cancelled. Rejects on real errors. */
  promise: Promise<RenderResult | null>;
  cancel(): void;
}

export interface RenderResult {
  viewport: PageViewport;
  geometry: PageGeometry;
}

export interface RenderOptions {
  /** CSS pixels per PDF point. */
  scale: number;
  /** Device pixel ratio; defaults to window.devicePixelRatio. */
  pixelRatio?: number;
}

/**
 * Render a page into `canvas`. Sets the canvas bitmap size (scale × pixel
 * ratio) and CSS size (scale). Cancel by calling `handle.cancel()`; a
 * cancelled render resolves to `null`.
 */
export function renderPageToCanvas(
  page: PageRef,
  source: SourceDoc,
  canvas: HTMLCanvasElement,
  options: RenderOptions,
): RenderHandle {
  let cancelled = false;
  let task: ReturnType<PDFPageProxy['render']> | null = null;
  const pixelRatio = options.pixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const geometry = getPageGeometry(page, source);

  const promise = (async (): Promise<RenderResult | null> => {
    const pdfPage = await getPdfJsPage(source, page.sourceIndex);
    if (cancelled) return null;
    const viewport = pdfPage.getViewport({ scale: options.scale * pixelRatio, rotation: geometry.totalRotation });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.style.width = `${viewport.width / pixelRatio}px`;
    canvas.style.height = `${viewport.height / pixelRatio}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    task = pdfPage.render({ canvasContext: ctx, canvas, viewport });
    try {
      await task.promise;
    } catch (err) {
      if (err instanceof pdfjsLib.RenderingCancelledException || cancelled) return null;
      throw err;
    }
    return { viewport: pdfPage.getViewport({ scale: options.scale, rotation: geometry.totalRotation }), geometry };
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
      task?.cancel();
    },
  };
}

// ---------- thumbnails ----------

const THUMB_CACHE_LIMIT = 400;
const thumbCache = new Map<string, Promise<string>>();
let active = 0;
const MAX_CONCURRENT_THUMBS = 2;
const queue: (() => void)[] = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT_THUMBS) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}

function release(): void {
  const next = queue.shift();
  if (next) next();
  else active--;
}

export function thumbnailKey(page: PageRef, source: SourceDoc, widthPx: number): string {
  const g = getPageGeometry(page, source);
  return `${page.sourceId}:${page.sourceIndex}:${g.totalRotation}:${widthPx}`;
}

/** Render (or fetch from cache) a PNG data URL thumbnail `widthPx` CSS pixels wide. */
export function getThumbnailDataUrl(page: PageRef, source: SourceDoc, widthPx: number): Promise<string> {
  const key = thumbnailKey(page, source, widthPx);
  const cached = thumbCache.get(key);
  if (cached) return cached;
  const p = (async () => {
    await acquire();
    try {
      const geometry = getPageGeometry(page, source);
      const scale = widthPx / geometry.displayWidth;
      const canvas = document.createElement('canvas');
      const result = await renderPageToCanvas(page, source, canvas, { scale, pixelRatio: 1.5 }).promise;
      if (!result) throw new Error('thumbnail render cancelled');
      return canvas.toDataURL('image/png');
    } finally {
      // The thumbnail is cached as a small PNG; without this, every page ever
      // scrolled into view kept its full-resolution decoded images alive.
      await releasePage(source, page.sourceIndex);
      release();
    }
  })();
  p.catch(() => thumbCache.delete(key));
  thumbCache.set(key, p);
  if (thumbCache.size > THUMB_CACHE_LIMIT) {
    const first = thumbCache.keys().next().value;
    if (first) thumbCache.delete(first);
  }
  return p;
}

export { pdfjsLib };
