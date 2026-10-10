import type { StandardFontName } from './types';

/**
 * Shared text layout constants so the on-screen overlay and the exported PDF
 * agree on where text lands. Ratios are relative to the font size and match
 * the standard 14 fonts closely enough for WYSIWYG placement.
 */
export const LINE_HEIGHT_RATIO = 1.2;
export const ASCENT_RATIO = 0.75;

export function lineHeight(fontSize: number): number {
  return fontSize * LINE_HEIGHT_RATIO;
}

export function ascent(fontSize: number): number {
  return fontSize * ASCENT_RATIO;
}

export function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/** Approximate advance width (points) when no real font metrics are at hand. */
export function approxTextWidth(text: string, fontSize: number, font: StandardFontName): number {
  const avg = font === 'Courier' ? 0.6 : font === 'Helvetica-Bold' ? 0.56 : 0.5;
  return Math.max(...splitLines(text).map((l) => l.length)) * fontSize * avg;
}

/** CSS font-family that visually approximates the PDF standard font. */
export function cssFontFamily(font: StandardFontName): string {
  switch (font) {
    case 'Courier':
      return '"Courier New", Courier, monospace';
    case 'TimesRoman':
      return '"Times New Roman", Times, serif';
    case 'Helvetica':
    case 'Helvetica-Bold':
    default:
      return 'Helvetica, Arial, sans-serif';
  }
}

export function cssFontWeight(font: StandardFontName): number {
  return font === 'Helvetica-Bold' ? 700 : 400;
}
