import { describe, expect, it } from 'vitest';
import {
  BOX_HIT_PADDING,
  INK_HIT_TOLERANCE,
  annotationBounds,
  hitTest,
  hitTestAnnotation,
  textBounds,
} from '@/components/Editor/hit-test';
import type { TextMeasurer } from '@/components/Editor/hit-test';
import type { Annotation, ImageAnnotation, InkAnnotation, RectAnnotation, TextAnnotation } from '@/core/types';
import { approxTextWidth, lineHeight } from '@/core/text-metrics';

const black = { r: 0, g: 0, b: 0 };

const text: TextAnnotation = {
  id: 't1',
  type: 'text',
  x: 100,
  y: 700,
  text: 'Hello\nWorld!',
  fontSize: 20,
  font: 'Helvetica',
  color: black,
};

const ink: InkAnnotation = {
  id: 'i1',
  type: 'ink',
  strokes: [
    [
      { x: 10, y: 10 },
      { x: 110, y: 10 },
      { x: 110, y: 60 },
    ],
  ],
  color: black,
  strokeWidth: 4,
  opacity: 1,
  blendMode: 'Normal',
};

const dot: InkAnnotation = { ...ink, id: 'dot', strokes: [[{ x: 300, y: 300 }]], strokeWidth: 6 };

const rect: RectAnnotation = {
  id: 'r1',
  type: 'rect',
  x: 200,
  y: 200,
  width: 100,
  height: 50,
  fillColor: null,
  strokeColor: black,
  strokeWidth: 2,
  opacity: 1,
  blendMode: 'Normal',
};

const image: ImageAnnotation = { id: 'img', type: 'image', x: 400, y: 100, width: 80, height: 40, dataUrl: 'data:,' };

describe('textBounds', () => {
  it('hangs below the top-left anchor with one line-height per line', () => {
    const b = textBounds(text);
    expect(b.x).toBe(100);
    expect(b.height).toBeCloseTo(2 * lineHeight(20));
    expect(b.y).toBeCloseTo(700 - 2 * lineHeight(20));
    expect(b.width).toBeCloseTo(approxTextWidth('World!', 20, 'Helvetica'));
  });

  it('uses the injected measurer for the widest line', () => {
    const measure: TextMeasurer = (line) => line.length * 7;
    expect(textBounds(text, measure).width).toBe(6 * 7);
  });

  it('keeps a minimum width for empty text so it stays selectable', () => {
    const b = textBounds({ ...text, text: '' });
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeCloseTo(lineHeight(20));
  });

  it('falls back to 12pt for invalid font sizes', () => {
    expect(textBounds({ ...text, text: 'x', fontSize: 0 }).height).toBeCloseTo(lineHeight(12));
  });
});

describe('annotationBounds', () => {
  it('pads ink by half the stroke width', () => {
    expect(annotationBounds(ink)).toEqual({ x: 8, y: 8, width: 104, height: 54 });
  });
  it('is the rect itself for rects and images', () => {
    expect(annotationBounds(rect)).toEqual({ x: 200, y: 200, width: 100, height: 50 });
    expect(annotationBounds(image)).toEqual({ x: 400, y: 100, width: 80, height: 40 });
  });
  it('handles ink without points', () => {
    expect(annotationBounds({ ...ink, strokes: [] })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('hitTestAnnotation', () => {
  it('hits ink within strokeWidth/2 + tolerance of a segment, not beyond', () => {
    const reach = ink.strokeWidth / 2 + INK_HIT_TOLERANCE; // 6
    expect(hitTestAnnotation(ink, { x: 60, y: 10 + reach - 0.01 })).toBe(true);
    expect(hitTestAnnotation(ink, { x: 60, y: 10 + reach + 0.01 })).toBe(false);
    // the second segment too
    expect(hitTestAnnotation(ink, { x: 112, y: 40 })).toBe(true);
    // inside the "corner" of the polyline but far from both segments: miss
    expect(hitTestAnnotation(ink, { x: 60, y: 50 })).toBe(false);
  });

  it('treats a single-point stroke as a dot', () => {
    expect(hitTestAnnotation(dot, { x: 300 + 3 + INK_HIT_TOLERANCE - 0.1, y: 300 })).toBe(true);
    expect(hitTestAnnotation(dot, { x: 300 + 3 + INK_HIT_TOLERANCE + 0.1, y: 300 })).toBe(false);
  });

  it('hits rects and images anywhere inside their box (plus padding)', () => {
    expect(hitTestAnnotation(rect, { x: 250, y: 225 })).toBe(true);
    expect(hitTestAnnotation(rect, { x: 200 - BOX_HIT_PADDING, y: 200 })).toBe(true);
    expect(hitTestAnnotation(rect, { x: 200 - BOX_HIT_PADDING - 0.5, y: 225 })).toBe(false);
    expect(hitTestAnnotation(image, { x: 479, y: 139 })).toBe(true);
    expect(hitTestAnnotation(image, { x: 390, y: 120 })).toBe(false);
  });

  it('hits text inside its bounding box, which hangs below the anchor', () => {
    const h = 2 * lineHeight(20);
    expect(hitTestAnnotation(text, { x: 110, y: 700 - h / 2 })).toBe(true);
    expect(hitTestAnnotation(text, { x: 110, y: 700 + 5 })).toBe(false); // above the top-left
    expect(hitTestAnnotation(text, { x: 110, y: 700 - h - 5 })).toBe(false); // below
  });

  it('honours custom tolerance/padding', () => {
    expect(hitTestAnnotation(rect, { x: 190, y: 225 }, { boxPadding: 10 })).toBe(true);
    expect(hitTestAnnotation(ink, { x: 60, y: 30 }, { inkTolerance: 20 })).toBe(true);
  });
});

describe('hitTest', () => {
  const stacked: Annotation[] = [
    rect,
    { ...rect, id: 'r2', x: 220, y: 210, width: 30, height: 20 }, // drawn later, on top
    ink,
  ];

  it('returns the topmost (last drawn) annotation under the point', () => {
    expect(hitTest(stacked, { x: 230, y: 215 })?.id).toBe('r2');
    expect(hitTest(stacked, { x: 205, y: 205 })?.id).toBe('r1');
    expect(hitTest(stacked, { x: 60, y: 10 })?.id).toBe('i1');
  });

  it('returns null on empty space', () => {
    expect(hitTest(stacked, { x: 500, y: 500 })).toBeNull();
    expect(hitTest([], { x: 0, y: 0 })).toBeNull();
  });
});
