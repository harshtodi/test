import { expect, type Download, type Page } from '@playwright/test';
import { PDFDocument, PDFDict, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import type * as PdfJs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { SAVE_MODE_KEY } from '../../src/platform';
import { makePdf, type FixturePage } from '../helpers/make-pdf';

export { makePdf, makeLabeledPdf, makeEncryptedPdf, TINY_PNG, TINY_JPEG } from '../helpers/make-pdf';
export type { FixturePage };

/**
 * Splice an APP1 Exif segment carrying only an Orientation tag (1–8) into a
 * JPEG, the way a phone camera marks a photo that must be rotated for display.
 */
export function withExifOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
  // "Exif\0\0" + little-endian TIFF header + one IFD0 entry (0x0112 SHORT ×1) + next-IFD 0
  const exif = [
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ];
  const length = exif.length + 2;
  return Uint8Array.from([...jpeg.subarray(0, 2), 0xff, 0xe1, length >> 8, length & 0xff, ...exif, ...jpeg.subarray(2)]);
}

/** Encode a 200×300 image (top half red, bottom half blue) with the browser's canvas encoder. */
export async function paintedImage(page: Page, mime: 'image/jpeg' | 'image/webp'): Promise<Uint8Array> {
  const b64 = await page.evaluate(async (type) => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 300;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 200, 150);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0, 150, 200, 150);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, type, 0.9));
    if (!blob) throw new Error(`${type} encoding failed`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }, mime);
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Open the app with web saves forced to plain downloads (no native picker). */
export async function openApp(page: Page): Promise<void> {
  await page.addInitScript(
    ([key]) => {
      try {
        localStorage.setItem(key!, 'download');
      } catch {
        /* ignore */
      }
    },
    [SAVE_MODE_KEY],
  );
  await page.goto('/');
  await expect(page.getByTestId('app')).toBeVisible();
}

export interface UploadFile {
  name: string;
  bytes: Uint8Array;
  mimeType?: string;
}

/** Feed files through the hidden <input type=file> (same code path as the Open button). */
export async function uploadFiles(page: Page, files: UploadFile[]): Promise<void> {
  await page.getByTestId('file-input').setInputFiles(
    files.map((f) => ({
      name: f.name,
      mimeType: f.mimeType ?? (f.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream'),
      buffer: Buffer.from(f.bytes),
    })),
  );
}

/** Simulate dropping files onto the window (fires the native drop handler). */
export async function dropFiles(page: Page, files: UploadFile[]): Promise<void> {
  const payload = files.map((f) => ({
    name: f.name,
    type: f.mimeType ?? (f.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream'),
    base64: Buffer.from(f.bytes).toString('base64'),
  }));
  await page.evaluate(async (items) => {
    const dt = new DataTransfer();
    for (const it of items) {
      const bin = atob(it.base64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      dt.items.add(new File([arr], it.name, { type: it.type }));
    }
    const target = document.body;
    target.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, payload);
}

export async function uploadPdf(page: Page, name: string, pages: FixturePage[]): Promise<void> {
  await uploadFiles(page, [{ name, bytes: await makePdf(pages) }]);
}

/** Wait for N thumbnails to be present. */
export async function expectPageCount(page: Page, count: number): Promise<void> {
  await expect(page.getByTestId('page-thumb')).toHaveCount(count);
}

/** Click Save (Ctrl+S) and capture the downloaded PDF bytes. */
export async function saveAndDownload(page: Page, trigger?: () => Promise<void>): Promise<Uint8Array> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    trigger ? trigger() : page.keyboard.press('ControlOrMeta+s'),
  ]);
  return downloadBytes(download);
}

export async function downloadBytes(download: Download): Promise<Uint8Array> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return new Uint8Array(Buffer.concat(chunks));
}

// ---------- output inspection (Node side) ----------

export async function loadOutput(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes);
}

/** Pixel size of every image XObject, page by page, in document order. */
export async function imageXObjectSizes(bytes: Uint8Array): Promise<{ width: number; height: number }[]> {
  const doc = await PDFDocument.load(bytes);
  const out: { width: number; height: number }[] = [];
  for (const pg of doc.getPages()) {
    const xobjects = pg.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
    if (!xobjects) continue;
    for (const [, ref] of xobjects.entries()) {
      const stream = doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) continue;
      if (stream.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
      out.push({
        width: stream.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber(),
        height: stream.dict.lookup(PDFName.of('Height'), PDFNumber).asNumber(),
      });
    }
  }
  return out;
}

export interface TextItem {
  str: string;
  /** pdf.js transform [a b c d e f] in user space. */
  transform: number[];
}

let pdfjsPromise: Promise<typeof PdfJs> | null = null;
function pdfjs(): Promise<typeof PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

/** Extract text items per page (1-based page order preserved) with pdf.js. */
export async function extractText(bytes: Uint8Array): Promise<TextItem[][]> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: bytes.slice(), useWorkerFetch: false }).promise;
  const out: TextItem[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i);
    const content = await pg.getTextContent();
    const items: TextItem[] = [];
    for (const it of content.items) {
      if ('str' in it) items.push({ str: it.str, transform: it.transform });
    }
    out.push(items);
  }
  await doc.destroy();
  return out;
}

/** Concatenated text per page, whitespace-normalised. */
export async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const items = await extractText(bytes);
  return items.map((its) => its.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim());
}

/** Centre of an element in page (viewport) coordinates. */
export async function centerOf(page: Page, testId: string, nth = 0) {
  const box = await page.getByTestId(testId).nth(nth).boundingBox();
  if (!box) throw new Error(`no bounding box for ${testId}[${nth}]`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}
