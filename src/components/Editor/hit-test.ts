/**
 * Geometric hit-testing of annotations in display space. Pure (no DOM): a
 * text measurer can be injected so the UI measures with the real CSS font
 * while tests fall back to the approximate metrics in core/text-metrics.
 */
import type { Annotation, Point, StandardFontName, TextAnnotation } from '@/core/types';
import { distanceToSegment, pointInRect } from '@/core/geometry';
import type { Rect } from '@/core/geometry';
import { approxTextWidth, lineHeight, splitLines } from '@/core/text-metrics';
import { pointsBounds } from './tools/stroke';

/** Width in points of a single line of text set in `font` at `fontSize`. */
export type TextMeasurer = (line: string, fontSize: number, font: StandardFontName) => number;

/** Extra reach (points) around an ink stroke that still counts as a hit. */
export const INK_HIT_TOLERANCE = 4;
/** Extra reach (points) around text/rect/image bounds. */
export const BOX_HIT_PADDING = 1;

export const approxMeasurer: TextMeasurer = (line, fontSize, font) => approxTextWidth(line, fontSize, font);

export interface HitTestOptions {
  measure?: TextMeasurer;
  inkTolerance?: number;
  boxPadding?: number;
}

/** Bounding box of a text annotation; `x`,`y` is the TOP-LEFT so the box hangs below it. */
export function textBounds(ann: TextAnnotation, measure: TextMeasurer = approxMeasurer): Rect {
  const lines = splitLines(ann.text);
  const fontSize = ann.fontSize > 0 ? ann.fontSize : 12;
  let width = 0;
  for (const line of lines) width = Math.max(width, line.length ? measure(line, fontSize, ann.font) : 0);
  // An empty box is unselectable; keep a thin minimum so the user can grab it.
  width = Math.max(width, fontSize * 0.5);
  const height = Math.max(1, lines.length) * lineHeight(fontSize);
  return { x: ann.x, y: ann.y - height, width, height };
}

/** Display-space bounds (bottom-left origin) of any annotation. */
export function annotationBounds(ann: Annotation, measure: TextMeasurer = approxMeasurer): Rect {
  switch (ann.type) {
    case 'text':
      return textBounds(ann, measure);
    case 'ink':
      return pointsBounds(ann.strokes.flat(), ann.strokeWidth / 2);
    case 'rect':
    case 'image':
      return { x: ann.x, y: ann.y, width: ann.width, height: ann.height };
  }
}

export function hitTestAnnotation(ann: Annotation, p: Point, options: HitTestOptions = {}): boolean {
  const pad = options.boxPadding ?? BOX_HIT_PADDING;
  switch (ann.type) {
    case 'ink': {
      const reach = ann.strokeWidth / 2 + (options.inkTolerance ?? INK_HIT_TOLERANCE);
      for (const stroke of ann.strokes) {
        const first = stroke[0];
        if (!first) continue;
        if (stroke.length === 1) {
          if (Math.hypot(p.x - first.x, p.y - first.y) <= reach) return true;
          continue;
        }
        for (let i = 1; i < stroke.length; i++) {
          if (distanceToSegment(p, stroke[i - 1]!, stroke[i]!) <= reach) return true;
        }
      }
      return false;
    }
    case 'text':
      return pointInRect(p, textBounds(ann, options.measure), pad);
    case 'rect':
    case 'image':
      return pointInRect(p, annotationBounds(ann), pad);
  }
}

/** Topmost (last drawn) annotation under `p`, or null. */
export function hitTest(annotations: readonly Annotation[], p: Point, options: HitTestOptions = {}): Annotation | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const ann = annotations[i]!;
    if (hitTestAnnotation(ann, p, options)) return ann;
  }
  return null;
}
