/**
 * Text measurement with the browser's own font rendering (a hidden 2D canvas),
 * so hit boxes, selection outlines and the inline editor agree with the SVG
 * preview. Falls back to the approximate metrics in core/text-metrics when no
 * canvas context is available.
 */
import type { StandardFontName } from '@/core/types';
import { approxTextWidth, cssFontFamily, cssFontWeight } from '@/core/text-metrics';
import { FALLBACK_CSS_BASELINE_RATIO, cssBaselineRatioFromMetrics } from './tools/text-edit';
import type { TextMeasurer } from './hit-test';

let context: CanvasRenderingContext2D | null | undefined;

function ctx(): CanvasRenderingContext2D | null {
  if (context === undefined) {
    try {
      context = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    } catch {
      context = null;
    }
  }
  return context;
}

export function cssFont(fontSizePx: number, font: StandardFontName): string {
  return `${cssFontWeight(font)} ${fontSizePx}px ${cssFontFamily(font)}`;
}

/** Advance width of one line. Units follow `fontSize` (points in → points out, px in → px out). */
export const measureTextWidth: TextMeasurer = (line, fontSize, font) => {
  const c = ctx();
  if (!c || !(fontSize > 0)) return approxTextWidth(line, fontSize, font);
  c.font = cssFont(fontSize, font);
  return c.measureText(line).width;
};

const baselineCache = new Map<StandardFontName, number>();

/**
 * Where the browser puts the baseline inside a line box of height 1.2em for
 * this font, as a fraction of the font size (see tools/text-edit.ts).
 */
export function cssBaselineRatio(font: StandardFontName): number {
  const cached = baselineCache.get(font);
  if (cached !== undefined) return cached;
  let ratio = FALLBACK_CSS_BASELINE_RATIO;
  const c = ctx();
  if (c) {
    const size = 100;
    c.font = cssFont(size, font);
    const m = c.measureText('Hg') as Partial<TextMetrics>;
    const asc = m.fontBoundingBoxAscent;
    const desc = m.fontBoundingBoxDescent;
    if (typeof asc === 'number' && typeof desc === 'number' && asc > 0) {
      ratio = cssBaselineRatioFromMetrics(asc / size, desc / size);
    }
  }
  baselineCache.set(font, ratio);
  return ratio;
}
