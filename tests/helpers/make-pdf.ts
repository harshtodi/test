import { PDFDocument, PDFHexString, PDFName, StandardFonts, degrees, rgb } from 'pdf-lib';

export interface FixturePage {
  /** Text drawn near the top-left so tests can identify the page. */
  label: string;
  width?: number;
  height?: number;
  /** /Rotate value for the page. Any multiple of 90 (negative or >= 360 too). */
  rotation?: number;
  /** Optional CropBox as [x, y, width, height] (pdf-lib convention). */
  cropBox?: [number, number, number, number];
}

/**
 * Build a small PDF in memory. Each page gets a large label so e2e tests can
 * recognise pages via pdf.js text extraction after a round trip.
 */
export async function makePdf(pages: FixturePage[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const spec of pages) {
    const page = doc.addPage([spec.width ?? 612, spec.height ?? 792]);
    page.drawText(spec.label, { x: 50, y: (spec.height ?? 792) - 80, size: 36, font, color: rgb(0, 0, 0) });
    page.drawRectangle({ x: 40, y: 40, width: (spec.width ?? 612) - 80, height: 4, color: rgb(0.2, 0.2, 0.8) });
    if (spec.rotation) page.setRotation(degrees(spec.rotation));
    if (spec.cropBox) page.setCropBox(...spec.cropBox);
  }
  return doc.save();
}

export async function makeLabeledPdf(count: number, prefix = 'Page'): Promise<Uint8Array> {
  return makePdf(Array.from({ length: count }, (_, i) => ({ label: `${prefix} ${i + 1}` })));
}

export interface StructuredPdfOptions {
  /** Number of pages (default 2). */
  pageCount?: number;
  /** Raw content stream of page `index` (0-based). Default: a "Page N" label set in /F1 (Helvetica). */
  content?: (index: number) => string;
  /**
   * Entries placed on the root /Pages node and removed from every page leaf,
   * so the pages inherit them. `Resources: true` moves the shared font
   * resources up the tree as well.
   */
  inherited?: {
    MediaBox?: [number, number, number, number];
    CropBox?: [number, number, number, number];
    Rotate?: number;
    Resources?: boolean;
  };
  /**
   * Make every page reference ONE indirect /Contents array (legal, and what
   * some generators emit for template pages). Every page then shows page 0's
   * content.
   */
  sharedContentsArray?: boolean;
}

/**
 * Build a PDF with hand-written page-tree structure (inherited attributes,
 * shared objects) that pdf-lib's high-level API never produces, to exercise
 * import/export against real-world document shapes.
 */
export async function makeStructuredPdf(options: StructuredPdfOptions = {}): Promise<Uint8Array> {
  const { pageCount = 2, inherited = {}, sharedContentsArray = false } = options;
  const content = options.content ?? ((i: number) => `BT /F1 36 Tf 50 700 Td (Page ${i + 1}) Tj ET`);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const { context } = doc;
  const resourcesRef = context.register(context.obj({ Font: { F1: font.ref } }));
  const pagesNode = doc.catalog.Pages();
  if (inherited.Resources) pagesNode.set(PDFName.of('Resources'), resourcesRef);
  if (inherited.MediaBox) pagesNode.set(PDFName.of('MediaBox'), context.obj(inherited.MediaBox));
  if (inherited.CropBox) pagesNode.set(PDFName.of('CropBox'), context.obj(inherited.CropBox));
  if (inherited.Rotate !== undefined) pagesNode.set(PDFName.of('Rotate'), context.obj(inherited.Rotate));
  const streamRef = (i: number) => context.register(context.stream(content(i)));
  const sharedContents = sharedContentsArray ? context.register(context.obj([streamRef(0)])) : null;
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([612, 792]);
    if (inherited.Resources) page.node.delete(PDFName.of('Resources'));
    else page.node.set(PDFName.of('Resources'), resourcesRef);
    if (inherited.MediaBox) page.node.delete(PDFName.of('MediaBox'));
    page.node.set(PDFName.of('Contents'), sharedContents ?? streamRef(i));
  }
  return doc.save({ useObjectStreams: false });
}

export interface UntypedPageTreeOptions {
  /** 0-based page leaves whose `/Type /Page` is removed, or 'all'. */
  leaves?: number[] | 'all';
  /** Remove `/Type /Pages` from the root page-tree node. */
  root?: boolean;
}

/**
 * A `count`-page PDF ("Original N" on each page) whose page tree lacks the
 * required `/Type` entries where requested. pdf.js and Acrobat still open such
 * files (a kid without /Kids is a page); pdf-lib on its own skips untyped
 * leaves and cannot traverse an untyped root.
 */
export async function makeUntypedPageTreePdf(count: number, options: UntypedPageTreeOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < count; i++) {
    doc.addPage([612, 792]).drawText(`Original ${i + 1}`, { x: 50, y: 700, size: 36, font });
  }
  const pages = doc.getPages();
  const leaves = options.leaves === 'all' ? pages.map((_, i) => i) : (options.leaves ?? []);
  for (const i of leaves) pages[i]!.node.delete(PDFName.of('Type'));
  if (options.root) doc.catalog.Pages().delete(PDFName.of('Type'));
  return doc.save({ useObjectStreams: false });
}

export interface InfoFixture {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
}

/** A one-page PDF with the given Info dictionary entries. */
export async function makePdfWithInfo(info: InfoFixture): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText('Info', { x: 50, y: 700, size: 36, font });
  if (info.title !== undefined) doc.setTitle(info.title);
  if (info.author !== undefined) doc.setAuthor(info.author);
  if (info.subject !== undefined) doc.setSubject(info.subject);
  if (info.keywords !== undefined) doc.setKeywords(info.keywords);
  return doc.save();
}

/**
 * A PDF whose trailer carries an /Encrypt dictionary. The content is not
 * actually encrypted, but readers (and pdf-lib) treat the file as encrypted,
 * which is what the import guard checks.
 */
export async function makeEncryptedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const encrypt = doc.context.obj({
    Filter: 'Standard',
    V: 1,
    R: 2,
    Length: 40,
    P: -1,
    O: PDFHexString.of('00'.repeat(32)),
    U: PDFHexString.of('00'.repeat(32)),
  });
  doc.context.trailerInfo.Encrypt = doc.context.register(encrypt);
  return doc.save({ useObjectStreams: false });
}

/** A PDF with a valid header and trailer but no pages. */
export async function makeEmptyPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // pdf-lib adds a default A4 page on save unless told otherwise.
  return doc.save({ addDefaultPage: false });
}

export function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function toDataUrl(bytes: Uint8Array, mime: 'image/png' | 'image/jpeg'): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/** 1×1 red PNG. */
export const TINY_PNG = base64ToBytes(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
);

/** 1×1 baseline JPEG (JFIF). */
export const TINY_JPEG = base64ToBytes(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z',
);

/**
 * `base` with an APP1 Exif segment (TIFF IFD0 with only the Orientation tag)
 * inserted after SOI, and the SOF frame header patched to `width` x `height`
 * so the embedder sees a photo-sized image. The scan data stays 1x1 (never
 * decoded by the importer).
 */
export function jpegWithExif(
  base: Uint8Array,
  orientation: number,
  width: number,
  height: number,
  byteOrder: 'II' | 'MM' = 'II',
): Uint8Array {
  const little = byteOrder === 'II';
  const u16 = (v: number) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number) => (little ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24] : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  const tiff = [
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(8), // IFD0 offset
    ...u16(1), // one entry
    ...u16(0x0112), // Orientation
    ...u16(3), // SHORT
    ...u32(1),
    ...u16(orientation),
    ...u16(0), // padding of the 4-byte value field
    ...u32(0), // next IFD
  ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0"
  const length = payload.length + 2;
  const app1 = [0xff, 0xe1, length >> 8, length & 0xff, ...payload];
  const out = new Uint8Array(base.length + app1.length);
  out.set(base.subarray(0, 2));
  out.set(app1, 2);
  out.set(base.subarray(2), 2 + app1.length);
  // Patch the SOF0/SOF2 frame header: marker(2) length(2) precision(1) height(2) width(2)
  for (let i = 2 + app1.length; i < out.length - 9; i++) {
    if (out[i] === 0xff && (out[i + 1] === 0xc0 || out[i + 1] === 0xc2)) {
      const at = i + 5;
      out[at] = height >> 8;
      out[at + 1] = height & 0xff;
      out[at + 2] = width >> 8;
      out[at + 3] = width & 0xff;
      break;
    }
  }
  return out;
}

/** 12 bytes of RIFF/WEBP header — enough to be detected as WebP. */
export const FAKE_WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
