/**
 * pdf.js in Node, for verifying exported PDFs the way a viewer sees them
 * (page count, text content and its position/orientation).
 */
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

const standardFontDataUrl = fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url));

export interface TextItem {
  str: string;
  /** [a, b, c, d, e, f] in PDF user space (pre-/Rotate). */
  transform: number[];
}

export async function loadWithPdfJs(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  // pdf.js takes ownership of the buffer: hand it a copy.
  return pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, standardFontDataUrl, verbosity: 0 }).promise;
}

/** Run `fn` against a pdf.js document and always release it. */
export async function withPdfJs<T>(bytes: Uint8Array, fn: (pdf: PDFDocumentProxy) => Promise<T>): Promise<T> {
  const pdf = await loadWithPdfJs(bytes);
  try {
    return await fn(pdf);
  } finally {
    await pdf.destroy();
  }
}

/** Text items (string + transform) of a 1-based page. */
export async function getTextItems(pdf: PDFDocumentProxy, pageNumber: number): Promise<TextItem[]> {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  const items: TextItem[] = [];
  for (const item of content.items) {
    if ('str' in item && item.str.trim().length > 0) items.push({ str: item.str, transform: item.transform });
  }
  return items;
}

/** The concatenated text of every page, in page order. */
export async function getPageTexts(bytes: Uint8Array): Promise<string[]> {
  return withPdfJs(bytes, async (pdf) => {
    const texts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const items = await getTextItems(pdf, i);
      texts.push(items.map((it) => it.str).join(' '));
    }
    return texts;
  });
}

/** Find the first text item on `pageNumber` whose string contains `needle`. */
export async function findText(bytes: Uint8Array, pageNumber: number, needle: string): Promise<TextItem | undefined> {
  return withPdfJs(bytes, async (pdf) => {
    const items = await getTextItems(pdf, pageNumber);
    return items.find((it) => it.str.includes(needle));
  });
}

/** pdf.js's view of a page: /Rotate and the visible box [x0, y0, x1, y1]. */
export async function getPageView(bytes: Uint8Array, pageNumber: number): Promise<{ rotate: number; view: number[] }> {
  return withPdfJs(bytes, async (pdf) => {
    const page = await pdf.getPage(pageNumber);
    return { rotate: page.rotate, view: page.view };
  });
}
