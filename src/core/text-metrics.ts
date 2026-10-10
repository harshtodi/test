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

/**
 * Split text into lines the way every renderer of a text annotation (SVG
 * overlay, hit testing, measurement, export) must: CRLF/CR/LF and the Unicode
 * line/paragraph separators break lines, and a tab becomes four spaces (SVG
 * would collapse it to one, the exporter to four; now they agree).
 */
export function splitLines(text: string): string[] {
  return text
    .replace(/\t/g, '    ')
    .replace(/\r\n?|\u2028|\u2029/g, '\n')
    .split('\n');
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

// ---------------------------------------------------------------------------
// What the built-in PDF fonts can show
// ---------------------------------------------------------------------------

/**
 * Code points of WinAnsiEncoding, the encoding pdf-lib uses for the Standard
 * 14 text fonts (Helvetica, Times, Courier). Kept in sync with pdf-lib by a
 * unit test that compares it against `font.encodeText` for every code point.
 */
const WIN_ANSI_RANGES: [number, number][] = [
  [0x20, 0x7e],
  [0xa0, 0xff],
  [0x152, 0x153], // Œ œ
  [0x160, 0x161], // Š š
  [0x178, 0x178], // Ÿ
  [0x17d, 0x17e], // Ž ž
  [0x192, 0x192], // ƒ
  [0x2c6, 0x2c6], // ˆ
  [0x2dc, 0x2dc], // ˜
  [0x2013, 0x2014], // – —
  [0x2018, 0x201a], // ‘ ’ ‚
  [0x201c, 0x201e], // “ ” „
  [0x2020, 0x2022], // † ‡ •
  [0x2026, 0x2026], // …
  [0x2030, 0x2030], // ‰
  [0x2039, 0x203a], // ‹ ›
  [0x20ac, 0x20ac], // €
  [0x2122, 0x2122], // ™
];

/** True when the Standard 14 text fonts can show this single character. */
export function isWinAnsiChar(ch: string): boolean {
  const code = ch.codePointAt(0);
  if (code === undefined || ch.length !== String.fromCodePoint(code).length) return false;
  return WIN_ANSI_RANGES.some(([lo, hi]) => code >= lo && code <= hi);
}

/** Counter filled by {@link sanitizeText}: how many characters became "?". */
export interface SanitizeStats {
  replaced: number;
}

/**
 * Make one line of text drawable with a font that only knows the characters
 * `canEncode` accepts. NFC-normalizes first so a decomposed "e + combining
 * acute" still becomes "é". Then, per character the font cannot encode:
 *  - control characters, invisible format characters (zero-width space,
 *    joiners, BOM ...) and combining marks / variation selectors are dropped,
 *  - a compatibility form (ligature "ﬁ", fullwidth "Ａ", "①" ...) is replaced
 *    by its NFKC equivalent when the font can show that,
 *  - anything else becomes "?" (counted in `stats`).
 */
export function sanitizeText(text: string, canEncode: (ch: string) => boolean, stats?: SanitizeStats): string {
  let out = '';
  for (const ch of text.normalize('NFC').replace(/\t/g, '    ')) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue; // control characters
    if (canEncode(ch)) {
      out += ch;
      continue;
    }
    if (/[\p{Cf}\p{M}]/u.test(ch)) continue; // invisible, or a mark on an already replaced base
    const alt = ch.normalize('NFKC');
    if (alt !== ch && alt.length > 0 && [...alt].every((c) => c.codePointAt(0)! >= 0x20 && canEncode(c))) {
      out += alt;
      continue;
    }
    out += '?';
    if (stats) stats.replaced++;
  }
  return out;
}

/**
 * The text the exported PDF will show for a text annotation drawn with a
 * built-in font: exactly what {@link sanitizeText} produces for WinAnsi. Lets
 * the on-screen preview match the saved file.
 */
export function exportPreviewText(text: string): string {
  return sanitizeText(text, isWinAnsiChar);
}
