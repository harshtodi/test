/**
 * Pure helpers for the inline text editor (the <textarea> drawn over the
 * canvas while a text annotation is being typed).
 */
import type { PageGeometry, StandardFontName } from '@/core/types';
import { displayToCanvas } from '@/core/geometry';
import { ASCENT_RATIO, LINE_HEIGHT_RATIO, splitLines } from '@/core/text-metrics';

export type TextCommitPlan = 'add' | 'update' | 'remove' | 'none';

/**
 * What to do with the store when the editor closes.
 * - new annotation: add it unless the text is blank;
 * - existing annotation: remove when blank, update when changed, else nothing.
 */
export function planTextCommit(isNew: boolean, originalText: string, text: string): TextCommitPlan {
  const blank = text.trim().length === 0;
  if (isNew) return blank ? 'none' : 'add';
  if (blank) return 'remove';
  return text === originalText ? 'none' : 'update';
}

/**
 * Where a browser puts the first baseline inside a line box, as a fraction
 * of the font size, when no font metrics are available. Measured value for
 * Arial/Helvetica at line-height 1.2 is ≈0.95, Times ≈0.94, Courier ≈0.87.
 */
export const FALLBACK_CSS_BASELINE_RATIO = 0.93;

/** Baseline position (fraction of font size) from the font's ascent/descent ratios. */
export function cssBaselineRatioFromMetrics(ascentRatio: number, descentRatio: number): number {
  if (!(ascentRatio > 0) || !(descentRatio >= 0)) return FALLBACK_CSS_BASELINE_RATIO;
  return (LINE_HEIGHT_RATIO - (ascentRatio + descentRatio)) / 2 + ascentRatio;
}

export interface TextEditorFrame {
  /** CSS px from the page's top-left corner. */
  left: number;
  top: number;
  width: number;
  height: number;
  fontSizePx: number;
  lineHeightPx: number;
}

export interface TextEditorInput {
  x: number;
  y: number;
  fontSize: number;
  font: StandardFontName;
  text: string;
}

export interface TextEditorMetrics {
  /** Browser baseline offset for this font (see cssBaselineRatioFromMetrics). */
  baselineRatio: number;
  /** Width in CSS px of one line at `fontSizePx`. */
  measureLine: (line: string, fontSizePx: number, font: StandardFontName) => number;
}

/**
 * Position and size for the textarea so its first baseline coincides with the
 * baseline the SVG overlay and the exporter use (top + ASCENT_RATIO·size).
 */
export function textEditorFrame(
  input: TextEditorInput,
  geometry: Pick<PageGeometry, 'displayHeight'>,
  scale: number,
  metrics: TextEditorMetrics,
): TextEditorFrame {
  const fontSizePx = input.fontSize * scale;
  const lineHeightPx = fontSizePx * LINE_HEIGHT_RATIO;
  const topLeft = displayToCanvas({ x: input.x, y: input.y }, geometry, scale);
  const lines = splitLines(input.text);
  let widest = 0;
  for (const line of lines) widest = Math.max(widest, line.length ? metrics.measureLine(line, fontSizePx, input.font) : 0);
  const baselineShift = (metrics.baselineRatio - ASCENT_RATIO) * fontSizePx;
  return {
    left: topLeft.x,
    top: topLeft.y - baselineShift,
    // room for the caret plus a little slack so the last glyph never clips
    width: Math.max(fontSizePx * 2, widest + fontSizePx),
    height: Math.max(1, lines.length) * lineHeightPx,
    fontSizePx,
    lineHeightPx,
  };
}
