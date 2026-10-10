import { expect, type Download, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import type * as PdfJs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { SAVE_MODE_KEY } from '../../src/platform';
import { makePdf, type FixturePage } from '../helpers/make-pdf';

export { makePdf, makeLabeledPdf, TINY_PNG } from '../helpers/make-pdf';
export type { FixturePage };

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
