/**
 * Small pdf-lib helpers shared by import.ts and export.ts. Pure TypeScript,
 * no DOM, safe to run in Node (unit tests) and in the renderer.
 */
import { PDFArray, PDFDict, PDFName, PDFPageLeaf, PDFPageTree, PDFRef } from 'pdf-lib';
import type { PDFDocument, PDFObject, PDFPage } from 'pdf-lib';
import type { Rotation } from './types';
import { normalizeRotation } from './geometry';

/** Kinds of input the importer understands. */
export type FileKind = 'pdf' | 'png' | 'jpeg' | 'webp' | 'unknown';

/** Axis-aligned box in PDF user space, with x0 <= x1 and y0 <= y1. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const LETTER_BOX: Box = { x0: 0, y0: 0, x1: 612, y1: 792 };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

/** Find the ASCII string `needle` within the first `limit` bytes of `bytes`. */
function indexOfAscii(bytes: Uint8Array, needle: string, limit: number): number {
  const end = Math.min(bytes.length, limit) - needle.length;
  const first = needle.charCodeAt(0);
  outer: for (let i = 0; i <= end; i++) {
    if (bytes[i] !== first) continue;
    for (let j = 1; j < needle.length; j++) {
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Detect the file kind from magic bytes, falling back to the file extension.
 * Image signatures sit at offset 0 and are checked first; PDFs may have junk
 * before the `%PDF-` header, so that marker is searched for within the first
 * KiB (pdf-lib tolerates such files as well). Checking images first keeps a
 * PNG/JPEG that happens to contain "%PDF-" in a metadata chunk from being
 * mistaken for a PDF.
 */
export function detectFileKind(bytes: Uint8Array, name: string): FileKind {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  if (indexOfAscii(bytes, '%PDF-', 1024) >= 0) return 'pdf';

  const ext = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'pdf';
    case 'png':
      return 'png';
    case 'jpg':
    case 'jpeg':
    case 'jpe':
    case 'jfif':
      return 'jpeg';
    case 'webp':
      return 'webp';
    default:
      return 'unknown';
  }
}

function isFiniteBox(b: { x: number; y: number; width: number; height: number }): boolean {
  return [b.x, b.y, b.width, b.height].every((n) => Number.isFinite(n));
}

/** Normalize a pdf-lib rectangle so that x0 <= x1 and y0 <= y1. */
function toBox(r: { x: number; y: number; width: number; height: number }): Box {
  const ax = r.x;
  const ay = r.y;
  const bx = r.x + r.width;
  const by = r.y + r.height;
  return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
}

function boxIsEmpty(b: Box): boolean {
  return !(b.x1 - b.x0 > 0 && b.y1 - b.y0 > 0);
}

/**
 * The page's visible box: CropBox ∩ MediaBox, falling back to the MediaBox
 * when the CropBox is missing or the intersection is empty, and to US Letter
 * when the MediaBox itself is unusable. Mirrors what pdf.js uses as
 * `page.view`, so the renderer and the exporter agree on the display origin.
 */
export function getVisibleBox(page: PDFPage): Box {
  let media: Box;
  try {
    const m = page.getMediaBox();
    media = isFiniteBox(m) ? toBox(m) : LETTER_BOX;
  } catch {
    media = LETTER_BOX;
  }
  if (boxIsEmpty(media)) media = LETTER_BOX;

  let crop: Box | null = null;
  try {
    const c = page.getCropBox();
    crop = isFiniteBox(c) ? toBox(c) : null;
  } catch {
    crop = null;
  }
  if (!crop) return media;

  const inter: Box = {
    x0: Math.max(media.x0, crop.x0),
    y0: Math.max(media.y0, crop.y0),
    x1: Math.min(media.x1, crop.x1),
    y1: Math.min(media.y1, crop.y1),
  };
  return boxIsEmpty(inter) ? media : inter;
}

/**
 * The page's effective /Rotate (own or inherited) normalized to 0/90/180/270.
 * Values that are not a multiple of 90 are invalid; pdf.js treats them as 0,
 * and so do we, so what is rendered matches what is exported.
 */
export function getPageRotation(page: PDFPage): Rotation {
  let angle = 0;
  try {
    angle = page.getRotation().angle;
  } catch {
    angle = 0;
  }
  if (!Number.isFinite(angle) || angle % 90 !== 0) return 0;
  return normalizeRotation(angle);
}

/**
 * Error message for encrypted files. pdf-lib cannot decrypt, not even files
 * with an empty user password (owner password only), which every viewer opens
 * without prompting; so tell the user what to do rather than to "remove" a
 * password they never typed.
 */
export function encryptedMessage(name: string): string {
  return (
    `${name} is encrypted, even if it opens without asking for a password. ` +
    `Save an unencrypted copy first (for example with your PDF viewer's "Print to PDF" or "Save as"), then open that copy here`
  );
}

/** Decode a base64 string to bytes (works in browsers, Electron and Node). */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface ParsedDataUrl {
  mime: string;
  bytes: Uint8Array;
}

/** Parse a `data:<mime>;base64,<payload>` URL. Throws a friendly error otherwise. */
export function parseDataUrl(dataUrl: string): ParsedDataUrl {
  const m = /^data:([^;,]+)(;[^,]*)?,(.*)$/s.exec(dataUrl.trim());
  if (!m) throw new Error('Image annotation has an invalid data URL');
  const mime = m[1]!.toLowerCase();
  const params = m[2] ?? '';
  const payload = m[3]!;
  let bytes: Uint8Array;
  try {
    bytes = /;base64/i.test(params) ? base64ToBytes(payload) : base64ToBytes(btoa(decodeURIComponent(payload)));
  } catch {
    throw new Error('Image annotation has a malformed data URL payload');
  }
  return { mime, bytes };
}

/**
 * Make pdf-lib enumerate the same pages as pdf.js.
 *
 * pdf-lib only treats dictionaries with `/Type /Pages` as tree nodes and
 * `/Type /Page` as page leaves (anything else is skipped, or breaks the
 * traversal when it is the root). pdf.js, like Acrobat, accepts nodes without
 * a `/Type` and treats every kid without `/Kids` as a page. A file with such a
 * leaf would otherwise render fine but import with fewer pages, so page *i* on
 * screen would be a different page than page *i* in the saved file.
 *
 * Replaces untyped nodes with proper `PDFPageTree` / `PDFPageLeaf` objects in
 * place. Must run right after `PDFDocument.load`, before the first `getPages()`
 * call (pdf-lib caches the page list).
 */
export function repairPageTree(doc: PDFDocument): void {
  const { context } = doc;
  const kidsKey = PDFName.of('Kids');
  const typeKey = PDFName.of('Type');
  const visited = new Set<PDFObject>();

  const visit = (entry: PDFObject | undefined, replace: (fixed: PDFDict) => void): void => {
    const node = entry instanceof PDFRef ? context.lookup(entry) : entry;
    if (!(node instanceof PDFDict)) return;
    const seenAs = entry instanceof PDFRef ? entry : node;
    if (visited.has(seenAs)) return; // cycles never end well
    visited.add(seenAs);

    let current: PDFDict = node;
    if (!(node instanceof PDFPageLeaf) && (!(node instanceof PDFPageTree) || !node.has(kidsKey))) {
      const map = new Map(node.entries());
      if (node.has(kidsKey)) {
        map.set(typeKey, PDFName.of('Pages'));
        current = PDFPageTree.fromMapWithContext(map, context);
      } else {
        map.set(typeKey, PDFName.of('Page'));
        current = PDFPageLeaf.fromMapWithContext(map, context);
      }
      if (entry instanceof PDFRef) context.assign(entry, current);
      else replace(current);
    }

    if (current instanceof PDFPageTree) {
      const kids = current.lookupMaybe(kidsKey, PDFArray);
      if (!kids) return;
      for (let i = 0; i < kids.size(); i++) visit(kids.get(i), (fixed) => kids.set(i, fixed));
    }
  };

  const pagesKey = PDFName.of('Pages');
  visit(doc.catalog.get(pagesKey), (fixed) => doc.catalog.set(pagesKey, fixed));
}
