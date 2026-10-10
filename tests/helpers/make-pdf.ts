import { PDFDocument, PDFHexString, StandardFonts, degrees, rgb } from 'pdf-lib';

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

/** 12 bytes of RIFF/WEBP header — enough to be detected as WebP. */
export const FAKE_WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
