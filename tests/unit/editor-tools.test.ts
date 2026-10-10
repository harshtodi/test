import { describe, expect, it } from 'vitest';
import { MIN_POINT_DISTANCE, appendStrokePoint, pointsBounds, simplifyStroke, translatePoints } from '@/components/Editor/tools/stroke';
import { fmt, fromSvgPoint, strokePathData, toSvgPoint, toSvgRect } from '@/components/Editor/tools/svg';
import {
  MIN_RECT_SIZE,
  SIGNATURE_MAX_WIDTH,
  clampPointToPage,
  clampTranslation,
  makeImageAnnotation,
  makeInkAnnotation,
  makeRectAnnotation,
  makeTextAnnotation,
  rectFromDrag,
  signaturePlacement,
  translateAnnotation,
} from '@/components/Editor/tools/shapes';
import { CORNERS, cornerPoint, cursorForCorner, hitCorner, oppositeCorner, resizeBox } from '@/components/Editor/tools/resize';
import { isStaleInteraction } from '@/components/Editor/tools/pointer';
import { NO_HOVER, cursorFor } from '@/components/Editor/tools/cursor';
import {
  FALLBACK_CSS_BASELINE_RATIO,
  cssBaselineRatioFromMetrics,
  planTextCommit,
  textEditorFrame,
} from '@/components/Editor/tools/text-edit';
import { centreAnchor, scrollDeltaForAnchor, wheelZoomFactor } from '@/components/Editor/tools/zoom';
import { DEFAULT_CANVAS_LIMITS, clampPixelRatio } from '@/components/Editor/tools/canvas-limits';
import { FIT_PADDING_PX, MIN_FIT_SCALE, fitScaleFor } from '@/components/Editor/tools/fit';
import { COLORS, DEFAULT_TOOL_SETTINGS } from '@/core/types';
import type { InkAnnotation, TextAnnotation } from '@/core/types';
import { ASCENT_RATIO, LINE_HEIGHT_RATIO } from '@/core/text-metrics';

const page = { displayWidth: 612, displayHeight: 792 };
const settings = DEFAULT_TOOL_SETTINGS;

describe('stroke helpers', () => {
  it('drops points closer than the minimum distance', () => {
    const pts: { x: number; y: number }[] = [];
    expect(appendStrokePoint(pts, { x: 0, y: 0 })).toBe(true);
    expect(appendStrokePoint(pts, { x: 0.3, y: 0.2 })).toBe(false);
    expect(appendStrokePoint(pts, { x: MIN_POINT_DISTANCE, y: 0 })).toBe(true);
    expect(appendStrokePoint(pts, { x: NaN, y: 0 })).toBe(false);
    expect(pts).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
    ]);
  });

  it('simplifyStroke keeps the first point and every point at least minDistance from its kept predecessor', () => {
    const raw = [
      { x: 0, y: 0 },
      { x: 0.1, y: 0 },
      { x: 0.2, y: 0 },
      { x: 0.6, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(simplifyStroke(raw)).toEqual([
      { x: 0, y: 0 },
      { x: 0.6, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(simplifyStroke([])).toEqual([]);
  });

  it('translates and bounds point sets', () => {
    const pts = [
      { x: 1, y: 2 },
      { x: 5, y: -3 },
    ];
    expect(translatePoints(pts, 10, 20)).toEqual([
      { x: 11, y: 22 },
      { x: 15, y: 17 },
    ]);
    expect(pointsBounds(pts)).toEqual({ x: 1, y: -3, width: 4, height: 5 });
    expect(pointsBounds(pts, 1)).toEqual({ x: 0, y: -4, width: 6, height: 7 });
    expect(pointsBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('svg coordinate helpers', () => {
  it('formats numbers compactly', () => {
    expect(fmt(12)).toBe('12');
    expect(fmt(12.5)).toBe('12.5');
    expect(fmt(12.004)).toBe('12');
    expect(fmt(0.126)).toBe('0.13');
    expect(fmt(NaN)).toBe('0');
  });

  it('flips y against the display height', () => {
    expect(toSvgPoint({ x: 10, y: 20 }, 100)).toEqual({ x: 10, y: 80 });
    expect(fromSvgPoint(toSvgPoint({ x: 10, y: 20 }, 100), 100)).toEqual({ x: 10, y: 20 });
    // display rect with bottom-left (10, 20) and height 30 has its top at y=50 → svg y = 100-50
    expect(toSvgRect({ x: 10, y: 20, width: 5, height: 30 }, 100)).toEqual({ x: 10, y: 50, width: 5, height: 30 });
  });

  it('builds path data, rendering a single point as a tiny segment (dot with round caps)', () => {
    expect(strokePathData([], 100)).toBe('');
    expect(strokePathData([{ x: 10, y: 10 }], 100)).toBe('M 10 90 l 0.01 0');
    expect(
      strokePathData(
        [
          { x: 0, y: 0 },
          { x: 10.5, y: 20 },
        ],
        100,
      ),
    ).toBe('M 0 100 L 10.5 80');
  });
});

describe('rect drag', () => {
  it('normalizes any corner order', () => {
    expect(rectFromDrag({ x: 100, y: 100 }, { x: 50, y: 20 })).toEqual({ x: 50, y: 20, width: 50, height: 80 });
  });
  it('rejects rectangles smaller than 2x2 pt', () => {
    expect(rectFromDrag({ x: 0, y: 0 }, { x: MIN_RECT_SIZE - 0.1, y: 100 })).toBeNull();
    expect(rectFromDrag({ x: 0, y: 0 }, { x: 100, y: 1 })).toBeNull();
    expect(rectFromDrag({ x: 0, y: 0 }, { x: 2, y: 2 })).toEqual({ x: 0, y: 0, width: 2, height: 2 });
  });
  it('clamps to the page when a page size is given', () => {
    expect(rectFromDrag({ x: -10, y: 700 }, { x: 50, y: 900 }, page)).toEqual({ x: 0, y: 700, width: 50, height: 92 });
    expect(clampPointToPage({ x: -1, y: 1000 }, page)).toEqual({ x: 0, y: 792 });
  });
});

describe('annotation factories', () => {
  const r = { x: 10, y: 20, width: 30, height: 40 };

  it('rect: stroke only, in the pen color', () => {
    const a = makeRectAnnotation('rect', r, settings, 'id');
    expect(a).toMatchObject({ id: 'id', type: 'rect', ...r, fillColor: null, strokeColor: settings.color });
    expect(a.strokeWidth).toBe(settings.strokeWidth);
    expect(a.opacity).toBe(1);
    expect(a.blendMode).toBe('Normal');
  });
  it('highlight-box: translucent multiply fill, no stroke', () => {
    const a = makeRectAnnotation('highlight-box', r, settings, 'id');
    expect(a.fillColor).toEqual(settings.highlighterColor);
    expect(a.strokeColor).toBeNull();
    expect(a.opacity).toBe(0.5);
    expect(a.blendMode).toBe('Multiply');
  });
  it('whiteout: opaque white fill, no stroke', () => {
    const a = makeRectAnnotation('whiteout', r, settings, 'id');
    expect(a.fillColor).toEqual(COLORS.white);
    expect(a.strokeColor).toBeNull();
    expect(a.opacity).toBe(1);
    expect(a.blendMode).toBe('Normal');
  });
  it('pen and highlighter ink', () => {
    const pts = [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ];
    const pen = makeInkAnnotation('pen', pts, settings, 'p');
    expect(pen).toEqual({
      id: 'p',
      type: 'ink',
      strokes: [pts],
      color: settings.color,
      strokeWidth: settings.strokeWidth,
      opacity: 1,
      blendMode: 'Normal',
    });
    expect(pen.strokes[0]).not.toBe(pts); // copied, not aliased
    const hl = makeInkAnnotation('highlighter', pts, settings, 'h');
    expect(hl).toMatchObject({
      color: settings.highlighterColor,
      strokeWidth: settings.highlighterWidth,
      opacity: 0.5,
      blendMode: 'Multiply',
    });
  });
  it('text starts empty at the click point with the text settings', () => {
    const t = makeTextAnnotation({ x: 5, y: 6 }, { ...settings, font: 'Courier', fontSize: 9 }, 't');
    expect(t).toEqual({ id: 't', type: 'text', x: 5, y: 6, text: '', fontSize: 9, font: 'Courier', color: settings.textColor });
  });
  it('generates unique ids by default', () => {
    const a = makeTextAnnotation({ x: 0, y: 0 }, settings);
    const b = makeTextAnnotation({ x: 0, y: 0 }, settings);
    expect(a.id).not.toBe(b.id);
    expect(makeImageAnnotation(r, 'data:,', 'i')).toEqual({ id: 'i', type: 'image', ...r, dataUrl: 'data:,' });
  });
});

describe('signaturePlacement', () => {
  it('is 200pt wide on a Letter page, centred on the click, with the image aspect ratio', () => {
    const box = signaturePlacement({ x: 306, y: 396 }, { width: 400, height: 100 }, page);
    expect(box.width).toBe(SIGNATURE_MAX_WIDTH);
    expect(box.height).toBe(50);
    expect(box.x).toBe(306 - 100);
    expect(box.y).toBe(396 - 25);
  });
  it('is 40% of the width on narrow pages', () => {
    const box = signaturePlacement({ x: 100, y: 100 }, { width: 200, height: 200 }, { displayWidth: 300, displayHeight: 300 });
    expect(box.width).toBeCloseTo(120);
    expect(box.height).toBeCloseTo(120);
  });
  it('stays on the page when clicked near an edge', () => {
    const box = signaturePlacement({ x: 600, y: 5 }, { width: 400, height: 100 }, page);
    expect(box.x).toBe(612 - 200);
    expect(box.y).toBe(0);
  });
  it('survives a degenerate image size', () => {
    const box = signaturePlacement({ x: 100, y: 100 }, { width: 0, height: 0 }, page);
    expect(box.height).toBeGreaterThan(0);
  });
});

describe('translateAnnotation / clampTranslation', () => {
  const ink: InkAnnotation = {
    id: 'i',
    type: 'ink',
    strokes: [[{ x: 1, y: 1 }], [{ x: 2, y: 2 }, { x: 3, y: 3 }]],
    color: COLORS.black,
    strokeWidth: 2,
    opacity: 1,
    blendMode: 'Normal',
  };
  const text: TextAnnotation = { id: 't', type: 'text', x: 10, y: 20, text: 'x', fontSize: 12, font: 'Helvetica', color: COLORS.black };

  it('moves ink points and positioned annotations relative to the original', () => {
    expect(translateAnnotation(ink, 5, -1)).toEqual({ strokes: [[{ x: 6, y: 0 }], [{ x: 7, y: 1 }, { x: 8, y: 2 }]] });
    expect(translateAnnotation(text, 5, -1)).toEqual({ x: 15, y: 19 });
  });

  it('keeps bounds inside the page', () => {
    const bounds = { x: 500, y: 700, width: 100, height: 50 };
    expect(clampTranslation(bounds, 50, 100, page)).toEqual({ x: 12, y: 42 });
    expect(clampTranslation(bounds, -600, -800, page)).toEqual({ x: -500, y: -700 });
    expect(clampTranslation(bounds, 5, -5, page)).toEqual({ x: 5, y: -5 });
  });

  it('lets an annotation that already pokes out move back in but not further out', () => {
    const bounds = { x: -20, y: 10, width: 50, height: 10 };
    expect(clampTranslation(bounds, -5, 0, page).x).toBe(0);
    expect(clampTranslation(bounds, 15, 0, page).x).toBe(15);
  });

  it('lets an oversized annotation slide between the edges', () => {
    const bounds = { x: 0, y: 0, width: 1000, height: 10 };
    expect(clampTranslation(bounds, -200, 0, page).x).toBe(-200);
    expect(clampTranslation(bounds, -500, 0, page).x).toBe(612 - 1000);
    expect(clampTranslation(bounds, 50, 0, page).x).toBe(0);
  });
});

describe('resize', () => {
  const box = { x: 100, y: 100, width: 200, height: 100 };

  it('names corners in display space (n = top = larger y)', () => {
    expect(cornerPoint(box, 'nw')).toEqual({ x: 100, y: 200 });
    expect(cornerPoint(box, 'ne')).toEqual({ x: 300, y: 200 });
    expect(cornerPoint(box, 'sw')).toEqual({ x: 100, y: 100 });
    expect(cornerPoint(box, 'se')).toEqual({ x: 300, y: 100 });
    for (const c of CORNERS) expect(oppositeCorner(oppositeCorner(c))).toBe(c);
  });

  it('hitCorner finds the handle under the pointer and the nearest when they overlap', () => {
    expect(hitCorner(box, { x: 301, y: 99 }, 8)).toBe('se');
    expect(hitCorner(box, { x: 200, y: 150 }, 8)).toBeNull();
    expect(hitCorner(box, { x: 100 + 4 + 2, y: 200 }, 8)).toBe('nw'); // slop included
    expect(hitCorner(box, { x: 100 + 4 + 2.5, y: 200 }, 8)).toBeNull();
    const tiny = { x: 0, y: 0, width: 2, height: 2 };
    expect(hitCorner(tiny, { x: 1.9, y: 1.9 }, 10)).toBe('ne');
  });

  it('drags the se corner, anchoring nw', () => {
    expect(resizeBox(box, 'se', { x: 350, y: 50 })).toEqual({ x: 100, y: 50, width: 250, height: 150 });
  });
  it('drags the nw corner, anchoring se', () => {
    expect(resizeBox(box, 'nw', { x: 50, y: 250 })).toEqual({ x: 50, y: 100, width: 250, height: 150 });
  });
  it('drags ne and sw', () => {
    expect(resizeBox(box, 'ne', { x: 400, y: 300 })).toEqual({ x: 100, y: 100, width: 300, height: 200 });
    expect(resizeBox(box, 'sw', { x: 150, y: 150 })).toEqual({ x: 150, y: 150, width: 150, height: 50 });
  });
  it('never flips: crossing the anchor shrinks to the minimum size instead', () => {
    const r = resizeBox(box, 'se', { x: 50, y: 300 }, { minSize: 2 });
    expect(r).toEqual({ x: 100, y: 198, width: 2, height: 2 });
  });
  it('keeps the aspect ratio for images, following the larger relative change', () => {
    const r = resizeBox(box, 'se', { x: 500, y: 150 }, { keepAspect: true });
    expect(r.width).toBeCloseTo(400);
    expect(r.height).toBeCloseTo(200);
    expect(r.x).toBe(100);
    expect(r.y).toBeCloseTo(0);
    const small = resizeBox(box, 'se', { x: 100, y: 200 }, { keepAspect: true, minSize: 10 });
    expect(small.width).toBeCloseTo(20);
    expect(small.height).toBeCloseTo(10);
  });
  it('a grab offset keeps the handle under the pointer: corner = pointer + (corner - pointerdown)', () => {
    // the user grabs the se handle 2pt left of / 1pt above the corner and drags by (50, -30)
    const grab = { x: 298, y: 101 };
    const corner = cornerPoint(box, 'se');
    const offset = { x: corner.x - grab.x, y: corner.y - grab.y };
    const pointer = { x: grab.x + 50, y: grab.y - 30 };
    const target = { x: pointer.x + offset.x, y: pointer.y + offset.y };
    expect(resizeBox(box, 'se', target)).toEqual({ x: 100, y: 70, width: 250, height: 130 });
    // and without movement the box is unchanged exactly
    expect(resizeBox(box, 'se', { x: grab.x + offset.x, y: grab.y + offset.y })).toEqual(box);
  });

  it('maps corners to resize cursors', () => {
    expect(cursorForCorner('nw')).toBe('nwse-resize');
    expect(cursorForCorner('se')).toBe('nwse-resize');
    expect(cursorForCorner('ne')).toBe('nesw-resize');
    expect(cursorForCorner('sw')).toBe('nesw-resize');
  });
});

describe('isStaleInteraction', () => {
  it('ignores a second finger or pen but recovers from a lost pointerup of the same pointer or a mouse', () => {
    expect(isStaleInteraction(7, { pointerId: 8, pointerType: 'touch' })).toBe(false);
    expect(isStaleInteraction(7, { pointerId: 8, pointerType: 'pen' })).toBe(false);
    expect(isStaleInteraction(7, { pointerId: 7, pointerType: 'touch' })).toBe(true);
    expect(isStaleInteraction(1, { pointerId: 1, pointerType: 'mouse' })).toBe(true);
    expect(isStaleInteraction(7, { pointerId: 1, pointerType: 'mouse' })).toBe(true);
  });
});

describe('cursorFor', () => {
  it('reflects the active drag first', () => {
    expect(cursorFor('select', 'ink', null, NO_HOVER, null)).toBe('crosshair');
    expect(cursorFor('select', 'move', null, NO_HOVER, null)).toBe('move');
    expect(cursorFor('select', 'resize', 'ne', NO_HOVER, null)).toBe('nesw-resize');
  });
  it('then the tool', () => {
    expect(cursorFor('text', null, null, NO_HOVER, null)).toBe('text');
    expect(cursorFor('pen', null, null, NO_HOVER, null)).toBe('crosshair');
    expect(cursorFor('whiteout', null, null, NO_HOVER, null)).toBe('crosshair');
    expect(cursorFor('signature', null, null, NO_HOVER, null)).toBe('copy');
  });
  it('and in select mode, what is hovered', () => {
    expect(cursorFor('select', null, null, NO_HOVER, null)).toBe('default');
    expect(cursorFor('select', null, null, { id: 'a', corner: null }, 'b')).toBe('pointer');
    expect(cursorFor('select', null, null, { id: 'a', corner: null }, 'a')).toBe('move');
    expect(cursorFor('select', null, null, { id: 'a', corner: 'sw' }, 'a')).toBe('nesw-resize');
  });
});

describe('text edit planning', () => {
  it('adds new annotations only when there is text', () => {
    expect(planTextCommit(true, '', 'hi')).toBe('add');
    expect(planTextCommit(true, '', '  \n ')).toBe('none');
  });
  it('removes/updates/keeps existing annotations', () => {
    expect(planTextCommit(false, 'old', '')).toBe('remove');
    expect(planTextCommit(false, 'old', 'old')).toBe('none');
    expect(planTextCommit(false, 'old', 'new')).toBe('update');
  });

  it('derives the browser baseline from font metrics', () => {
    // Arial-like: ascent .905, descent .212 at line-height 1.2
    const ratio = cssBaselineRatioFromMetrics(0.905, 0.212);
    expect(ratio).toBeCloseTo((LINE_HEIGHT_RATIO - 1.117) / 2 + 0.905);
    expect(cssBaselineRatioFromMetrics(0, 0)).toBe(FALLBACK_CSS_BASELINE_RATIO);
  });

  it('positions the textarea so its first baseline matches the overlay baseline', () => {
    const frame = textEditorFrame(
      { x: 100, y: 700, fontSize: 12, font: 'Helvetica', text: 'ab\ncd' },
      { displayHeight: 792 },
      2,
      { baselineRatio: 0.95, measureLine: (line, px) => line.length * px * 0.5 },
    );
    expect(frame.fontSizePx).toBe(24);
    expect(frame.lineHeightPx).toBeCloseTo(24 * LINE_HEIGHT_RATIO);
    expect(frame.left).toBe(200);
    // top-left of the text in canvas px is (200, 184); shift up by (0.95 - ASCENT) * 24
    expect(frame.top).toBeCloseTo(184 - (0.95 - ASCENT_RATIO) * 24);
    expect(frame.width).toBeCloseTo(Math.max(48, 24 + 24));
    expect(frame.height).toBeCloseTo(2 * 24 * LINE_HEIGHT_RATIO);
  });
});

describe('zoom helpers', () => {
  it('wheel up zooms in, wheel down zooms out, bounded', () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(-100) * wheelZoomFactor(100)).toBeCloseTo(1);
    expect(wheelZoomFactor(-10_000)).toBe(2);
    expect(wheelZoomFactor(10_000)).toBe(0.5);
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(NaN)).toBe(1);
    // line-mode deltas are scaled up
    expect(wheelZoomFactor(-3, 1)).toBeGreaterThan(wheelZoomFactor(-3, 0));
  });

  it('computes the scroll correction that keeps the anchored point under the pointer', () => {
    const anchor = { clientX: 400, clientY: 300, px: 100, py: 50 };
    // page top-left after relayout at (250, 200), new scale 2 → the point is at (450, 300)
    expect(scrollDeltaForAnchor(anchor, 250, 200, 2)).toEqual({ dx: 50, dy: 0 });
  });

  it('centreAnchor keeps the page point under the viewport centre through a pointer-less zoom step', () => {
    const viewport = { left: 0, top: 0, width: 1000, height: 700 };
    // page top-left at (100, -300) at scale 2: the viewport centre (500, 350) is page point (200, 325)
    const anchor = centreAnchor(viewport, 100, -300, 2);
    expect(anchor).toEqual({ clientX: 500, clientY: 350, px: 200, py: 325 });
    // at scale 2.5 that point sits at (100 + 500, -300 + 812.5) before any scroll correction
    expect(scrollDeltaForAnchor(anchor, 100, -300, 2.5)).toEqual({ dx: 100, dy: 162.5 });
    // same scale → nothing to correct
    expect(scrollDeltaForAnchor(anchor, 100, -300, 2)).toEqual({ dx: 0, dy: 0 });
    // the scroller does not have to start at the viewport origin
    expect(centreAnchor({ left: 200, top: 50, width: 800, height: 600 }, 200, 50, 1)).toEqual({ clientX: 600, clientY: 350, px: 400, py: 300 });
    // a non-positive scale (no layout yet) is treated as 1 rather than dividing by zero
    expect(centreAnchor(viewport, 0, 0, 0)).toEqual({ clientX: 500, clientY: 350, px: 500, py: 350 });
  });
});

describe('canvas limits and fit', () => {
  it('keeps the bitmap within the side and area limits', () => {
    expect(clampPixelRatio(600, 800, 2)).toBe(2);
    const { maxSide, maxArea } = DEFAULT_CANVAS_LIMITS;
    const r = clampPixelRatio(10_000, 500, 2);
    expect(r * 10_000).toBeLessThanOrEqual(maxSide + 1e-6);
    const r2 = clampPixelRatio(7000, 7000, 2);
    expect(r2 * r2 * 7000 * 7000).toBeLessThanOrEqual(maxArea + 1e-3);
    expect(clampPixelRatio(0, 0, 2)).toBe(2);
    expect(clampPixelRatio(100, 100, NaN)).toBe(1);
  });

  it('fit scale uses the container width minus padding', () => {
    expect(fitScaleFor(612 + FIT_PADDING_PX, 612)).toBe(1);
    expect(fitScaleFor(1000, 500)).toBeCloseTo((1000 - FIT_PADDING_PX) / 500);
    expect(fitScaleFor(10, 612)).toBe(MIN_FIT_SCALE);
    expect(fitScaleFor(0, 612)).toBe(1);
  });
});
