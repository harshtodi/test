/**
 * Unicode fallback for text annotations.
 *
 * The exporter embeds only the PDF standard fonts (WinAnsi: Latin-1 plus a
 * few symbols). Text in other scripts (CJK, Arabic, Devanagari, Cyrillic,
 * emoji ...) would otherwise be exported as "?". Before saving, such text
 * annotations are rasterised with the browser's own fonts at high resolution
 * and exported as images, so the saved page shows exactly what the editor
 * showed. Latin text keeps going out as real, selectable PDF text.
 */
import type { Annotation, ImageAnnotation, PageRef, TextAnnotation } from '@/core/types';
import { ascent, cssFontFamily, cssFontWeight, isWinAnsiChar, lineHeight, sanitizeText, splitLines } from '@/core/text-metrics';
import { rgbToCss } from '@/core/color';

/** Pixels per PDF point used for the raster (4 ≈ 288 dpi). */
const RASTER_SCALE = 4;
/** Keep a single raster below ~16M pixels. */
const MAX_PIXELS = 16_000_000;

/** True when the standard fonts cannot show every character of this text. */
export function needsRasterFallback(text: string): boolean {
  const stats = { replaced: 0 };
  sanitizeText(text, isWinAnsiChar, stats);
  return stats.replaced > 0;
}

/**
 * Draw the text block to a canvas and return an equivalent image annotation
 * occupying the same display-space box (top-left anchored text → bottom-left
 * anchored image). Returns null when the browser cannot rasterise.
 */
export function rasterizeTextAnnotation(a: TextAnnotation): ImageAnnotation | null {
  if (typeof document === 'undefined') return null;
  const lines = splitLines(a.text.replace(/\t/g, '    '));
  const lh = lineHeight(a.fontSize);
  const asc = ascent(a.fontSize);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const font = `${cssFontWeight(a.font)} ${a.fontSize * RASTER_SCALE}px ${cssFontFamily(a.font)}`;
  ctx.font = font;
  const widthPx = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
  const heightPt = lh * lines.length;
  let scale = RASTER_SCALE;
  const pixels = (widthPx + 2) * (heightPt * RASTER_SCALE + 2);
  if (pixels > MAX_PIXELS) scale = RASTER_SCALE * Math.sqrt(MAX_PIXELS / pixels);
  const widthPt = widthPx / RASTER_SCALE;
  canvas.width = Math.ceil(widthPt * scale) + 2;
  canvas.height = Math.ceil(heightPt * scale) + 2;
  // the canvas resize reset the context state
  ctx.font = `${cssFontWeight(a.font)} ${a.fontSize * scale}px ${cssFontFamily(a.font)}`;
  ctx.fillStyle = rgbToCss(a.color);
  ctx.textBaseline = 'alphabetic';
  lines.forEach((line, i) => ctx.fillText(line, 1, 1 + (asc + i * lh) * scale));
  return {
    id: a.id,
    type: 'image',
    x: a.x,
    y: a.y - heightPt,
    width: widthPt,
    height: heightPt,
    dataUrl: canvas.toDataURL('image/png'),
  };
}

/** Return pages whose non-WinAnsi text annotations are replaced by rasters (originals untouched). */
export function prepareTextForExport(pages: PageRef[]): { pages: PageRef[]; rasterized: number } {
  let rasterized = 0;
  const out = pages.map((p) => {
    if (!p.annotations.some((a) => a.type === 'text' && needsRasterFallback(a.text))) return p;
    const annotations: Annotation[] = p.annotations.map((a) => {
      if (a.type !== 'text' || !needsRasterFallback(a.text)) return a;
      const img = rasterizeTextAnnotation(a);
      if (!img) return a;
      rasterized++;
      return img;
    });
    return { ...p, annotations };
  });
  return { pages: out, rasterized };
}
