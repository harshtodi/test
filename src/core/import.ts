/**
 * File import: turns PDFs and images into {@link SourceDoc}s.
 *
 * - PDFs keep their ORIGINAL bytes (never re-saved); only per-page metadata
 *   (visible box size, /Rotate) is extracted with pdf-lib.
 * - Images (PNG, JPEG) become a one-page US Letter PDF with the image scaled
 *   to fit and centered. A JPEG's EXIF orientation becomes the page's /Rotate,
 *   so phone photos come in the way every viewer shows them. WebP and other
 *   formats must be converted to PNG by the caller first (the UI does this
 *   with a canvas).
 * - Blank pages are one-page PDFs too, so every source is a PDF.
 *
 * Pure TypeScript, no DOM: runs in Node under Vitest.
 */
import { PDFDocument, ParseSpeeds, degrees } from 'pdf-lib';
import type { PDFImage, PDFPage } from 'pdf-lib';
import type { Rotation, SourceDoc, SourcePageInfo } from './types';
import { newId } from './ids';
import { detectFileKind, encryptedMessage, getPageRotation, getVisibleBox, repairPageTree } from './pdf-utils';

const LETTER = { width: 612, height: 792 } as const;

/**
 * Options accepted by pdf-lib when we only read a document. `Fastest` disables
 * pdf-lib's `setTimeout(0)` yield every 100 objects: browsers clamp nested
 * timers to 4 ms, which made opening object-heavy files ~10x slower without
 * buying any responsiveness (the UI is blocked between ticks anyway).
 */
const LOAD_OPTIONS = { ignoreEncryption: true, updateMetadata: false, parseSpeed: ParseSpeeds.Fastest } as const;

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
  if (doc.isEncrypted) throw new Error(encryptedMessage(name));

  let pages: SourcePageInfo[];
  try {
    // Before the first getPages(): make pdf-lib see the pages pdf.js renders.
    repairPageTree(doc);
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

  // pdf-lib embeds the JPEG's pixels as stored; viewers show a phone photo
  // rotated by its EXIF orientation. Reproduce that with the page's /Rotate.
  const rotation: Rotation = kind === 'jpeg' ? exifRotation(jpegExifOrientation(bytes)) : 0;
  const swapped = rotation === 90 || rotation === 270;

  // Letter page oriented like the DISPLAYED image, image scaled to fit and
  // centered. The unrotated page is the displayed page turned back.
  const shownWidth = swapped ? image.height : image.width;
  const shownHeight = swapped ? image.width : image.height;
  const landscape = shownWidth > shownHeight;
  const displayWidth = landscape ? LETTER.height : LETTER.width;
  const displayHeight = landscape ? LETTER.width : LETTER.height;
  const pageWidth = swapped ? displayHeight : displayWidth;
  const pageHeight = swapped ? displayWidth : displayHeight;

  const fitted = image.scaleToFit(pageWidth, pageHeight);
  const page = doc.addPage([pageWidth, pageHeight]);
  page.drawImage(image, {
    x: (pageWidth - fitted.width) / 2,
    y: (pageHeight - fitted.height) / 2,
    width: fitted.width,
    height: fitted.height,
  });
  if (rotation !== 0) page.setRotation(degrees(rotation));
  setMetadata(doc);
  const pdfBytes = await doc.save();

  return {
    id: newId('src'),
    name,
    bytes: pdfBytes,
    pageCount: 1,
    pages: [{ width: pageWidth, height: pageHeight, rotation }],
  };
}

/** A one-page blank PDF source of the given size (points). */
export async function createBlankPageSource(width: number, height: number): Promise<SourceDoc> {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Blank page size must be positive');
  }
  const doc = await PDFDocument.create();
  doc.addPage([width, height]);
  setMetadata(doc);
  const bytes = await doc.save();
  return {
    id: newId('src'),
    name: 'Blank page',
    bytes,
    pageCount: 1,
    pages: [{ width, height, rotation: 0 }],
  };
}

/**
 * Producer/Creator only: generated sources get no Title, so that a document
 * starting with a photo or a blank page is not titled "photo.jpg" or
 * "Blank page" on export (the exporter keeps the first source's Title).
 */
function setMetadata(doc: PDFDocument): void {
  doc.setProducer('PDF Editor');
  doc.setCreator('PDF Editor');
}

// ---------------------------------------------------------------------------
// JPEG EXIF orientation
// ---------------------------------------------------------------------------

/** Clockwise /Rotate that shows an image stored with this EXIF orientation upright (mirroring is ignored). */
export function exifRotation(orientation: number): Rotation {
  switch (orientation) {
    case 3:
    case 4:
      return 180;
    case 5:
    case 6:
      return 90;
    case 7:
    case 8:
      return 270;
    default:
      return 0;
  }
}

/**
 * The EXIF Orientation tag (1..8) of a JPEG, or 1 when there is none or the
 * metadata is unreadable. Walks the marker segments up to the image data and
 * reads IFD0 of the APP1 "Exif" segment; nothing is decoded.
 */
export function jpegExifOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) return 1;
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return 1;
    const marker = bytes[pos + 1]!;
    if (marker === 0xff) {
      pos += 1; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      pos += 2; // standalone marker (TEM, RSTn, SOI)
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return 1; // image data / end: no more metadata
    const length = view.getUint16(pos + 2);
    if (length < 2) return 1;
    const start = pos + 4;
    const end = Math.min(bytes.length, pos + 2 + length);
    if (marker === 0xe1 && end - start >= 14 && hasExifHeader(bytes, start)) {
      return tiffOrientation(view, start + 6, end);
    }
    pos += 2 + length;
  }
  return 1;
}

function hasExifHeader(bytes: Uint8Array, at: number): boolean {
  return (
    bytes[at] === 0x45 && // E
    bytes[at + 1] === 0x78 && // x
    bytes[at + 2] === 0x69 && // i
    bytes[at + 3] === 0x66 && // f
    bytes[at + 4] === 0 &&
    bytes[at + 5] === 0
  );
}

function tiffOrientation(view: DataView, tiff: number, end: number): number {
  if (tiff + 8 > end) return 1;
  const byteOrder = view.getUint16(tiff);
  const little = byteOrder === 0x4949;
  if (!little && byteOrder !== 0x4d4d) return 1;
  if (view.getUint16(tiff + 2, little) !== 42) return 1;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd < tiff || ifd + 2 > end) return 1;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return 1;
    if (view.getUint16(entry, little) !== 0x0112) continue;
    const type = view.getUint16(entry + 2, little);
    const n = view.getUint32(entry + 4, little);
    if (type !== 3 || n !== 1) return 1;
    const value = view.getUint16(entry + 8, little);
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}
