/**
 * File import: turns PDFs and images into {@link SourceDoc}s.
 *
 * - PDFs keep their ORIGINAL bytes (never re-saved); only per-page metadata
 *   (visible box size, /Rotate) is extracted with pdf-lib.
 * - Images (PNG, JPEG) become a one-page US Letter PDF with the image scaled
 *   to fit and centered. WebP and other formats must be converted to PNG by
 *   the caller first (the UI does this with a canvas).
 * - Blank pages are one-page PDFs too, so every source is a PDF.
 *
 * Pure TypeScript, no DOM: runs in Node under Vitest.
 */
import { PDFDocument } from 'pdf-lib';
import type { PDFImage, PDFPage } from 'pdf-lib';
import type { SourceDoc, SourcePageInfo } from './types';
import { newId } from './ids';
import { detectFileKind, getPageRotation, getVisibleBox } from './pdf-utils';

const LETTER = { width: 612, height: 792 } as const;

/** Options accepted by pdf-lib when we only read a document. */
const LOAD_OPTIONS = { ignoreEncryption: true, updateMetadata: false } as const;

/**
 * Import a file (PDF, PNG or JPEG) as a source document.
 * Throws an `Error` with a user-friendly message for encrypted, corrupt or
 * unsupported input.
 */
export async function importFile(name: string, bytes: Uint8Array): Promise<SourceDoc> {
  if (!(bytes instanceof Uint8Array)) throw new Error(`${name}: expected file bytes`);
  if (bytes.length === 0) throw new Error(`${name} is empty`);

  const kind = detectFileKind(bytes, name);
  switch (kind) {
    case 'pdf':
      return importPdf(name, bytes);
    case 'png':
    case 'jpeg':
      return importImage(name, bytes, kind);
    case 'webp':
      throw new Error(`${name} is a WebP image, which must be converted to PNG before import`);
    default:
      throw new Error(`${name} is not a supported file type (PDF, PNG or JPEG)`);
  }
}

async function importPdf(name: string, bytes: Uint8Array): Promise<SourceDoc> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, LOAD_OPTIONS);
  } catch {
    throw new Error(`${name} could not be read: it is not a valid PDF file or it is damaged`);
  }
  if (doc.isEncrypted) {
    throw new Error(`${name} is password protected; remove the password first`);
  }

  let pages: SourcePageInfo[];
  try {
    pages = doc.getPages().map(readPageInfo);
  } catch {
    throw new Error(`${name} could not be read: its page tree is damaged`);
  }
  if (pages.length === 0) throw new Error(`${name} contains no pages`);

  return { id: newId('src'), name, bytes, pageCount: pages.length, pages };
}

function readPageInfo(page: PDFPage): SourcePageInfo {
  const box = getVisibleBox(page);
  return { width: box.x1 - box.x0, height: box.y1 - box.y0, rotation: getPageRotation(page) };
}

async function importImage(name: string, bytes: Uint8Array, kind: 'png' | 'jpeg'): Promise<SourceDoc> {
  const doc = await PDFDocument.create();
  let image: PDFImage;
  try {
    image = kind === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    throw new Error(`${name} could not be decoded as a ${kind === 'png' ? 'PNG' : 'JPEG'} image`);
  }
  if (!(image.width > 0) || !(image.height > 0)) {
    throw new Error(`${name} has an invalid image size`);
  }

  // Letter page, oriented like the image, image scaled to fit and centered.
  const landscape = image.width > image.height;
  const pageWidth = landscape ? LETTER.height : LETTER.width;
  const pageHeight = landscape ? LETTER.width : LETTER.height;
  const fitted = image.scaleToFit(pageWidth, pageHeight);
  const page = doc.addPage([pageWidth, pageHeight]);
  page.drawImage(image, {
    x: (pageWidth - fitted.width) / 2,
    y: (pageHeight - fitted.height) / 2,
    width: fitted.width,
    height: fitted.height,
  });
  setMetadata(doc, name);
  const pdfBytes = await doc.save();

  return {
    id: newId('src'),
    name,
    bytes: pdfBytes,
    pageCount: 1,
    pages: [{ width: pageWidth, height: pageHeight, rotation: 0 }],
  };
}

/** A one-page blank PDF source of the given size (points). */
export async function createBlankPageSource(width: number, height: number): Promise<SourceDoc> {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Blank page size must be positive');
  }
  const doc = await PDFDocument.create();
  doc.addPage([width, height]);
  setMetadata(doc, 'Blank page');
  const bytes = await doc.save();
  return {
    id: newId('src'),
    name: 'Blank page',
    bytes,
    pageCount: 1,
    pages: [{ width, height, rotation: 0 }],
  };
}

function setMetadata(doc: PDFDocument, title: string): void {
  doc.setTitle(title);
  doc.setProducer('PDF Editor');
  doc.setCreator('PDF Editor');
}
