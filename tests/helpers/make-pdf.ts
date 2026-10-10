import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

export interface FixturePage {
  /** Text drawn near the top-left so tests can identify the page. */
  label: string;
  width?: number;
  height?: number;
  /** /Rotate value for the page. */
  rotation?: 0 | 90 | 180 | 270;
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
  }
  return doc.save();
}

export async function makeLabeledPdf(count: number, prefix = 'Page'): Promise<Uint8Array> {
  return makePdf(Array.from({ length: count }, (_, i) => ({ label: `${prefix} ${i + 1}` })));
}

/** 1×1 red PNG. */
export const TINY_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);
