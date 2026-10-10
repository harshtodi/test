import { describe, expect, it } from 'vitest';
import {
  addRotation,
  applyMatrix,
  canvasToDisplay,
  displayToCanvas,
  displayToUserMatrix,
  getPageGeometry,
  normalizeRotation,
} from '@/core/geometry';
import type { PageRef, Rotation, SourceDoc } from '@/core/types';

describe('rotation helpers', () => {
  it('normalizes any multiple of 90 into 0/90/180/270', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-180)).toBe(180);
    expect(normalizeRotation(720)).toBe(0);
    expect(addRotation(270, 90)).toBe(0);
    expect(addRotation(0, -90)).toBe(270);
  });
});

describe('displayToUserMatrix', () => {
  const box = { x0: 100, y0: 50, x1: 400, y1: 850 }; // 300 × 800 visible box
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;

  it('maps the display corners onto the visible box corners for every rotation', () => {
    const cases: { rotation: Rotation; displayW: number; displayH: number }[] = [
      { rotation: 0, displayW: w, displayH: h },
      { rotation: 90, displayW: h, displayH: w },
      { rotation: 180, displayW: w, displayH: h },
      { rotation: 270, displayW: h, displayH: w },
    ];
    for (const { rotation, displayW, displayH } of cases) {
      const m = displayToUserMatrix(box, rotation);
      const corners = [
        { x: 0, y: 0 },
        { x: displayW, y: 0 },
        { x: displayW, y: displayH },
        { x: 0, y: displayH },
      ].map((p) => applyMatrix(m, p));
      const xs = corners.map((p) => p.x).sort((a, b) => a - b);
      const ys = corners.map((p) => p.y).sort((a, b) => a - b);
      expect(xs[0]).toBeCloseTo(box.x0);
      expect(xs[3]).toBeCloseTo(box.x1);
      expect(ys[0]).toBeCloseTo(box.y0);
      expect(ys[3]).toBeCloseTo(box.y1);
    }
  });

  it('matches the PDF /Rotate semantics (clockwise display rotation)', () => {
    // 90° clockwise: the unrotated bottom-right corner becomes the displayed bottom-left.
    expect(applyMatrix(displayToUserMatrix(box, 90), { x: 0, y: 0 })).toEqual({ x: box.x1, y: box.y0 });
    // displayed bottom-right = unrotated top-right
    expect(applyMatrix(displayToUserMatrix(box, 90), { x: h, y: 0 })).toEqual({ x: box.x1, y: box.y1 });
    // 270°: displayed bottom-left = unrotated top-left
    expect(applyMatrix(displayToUserMatrix(box, 270), { x: 0, y: 0 })).toEqual({ x: box.x0, y: box.y1 });
    // 180°: displayed bottom-left = unrotated top-right
    expect(applyMatrix(displayToUserMatrix(box, 180), { x: 0, y: 0 })).toEqual({ x: box.x1, y: box.y1 });
  });
});

describe('page geometry and canvas conversion', () => {
  const source: SourceDoc = {
    id: 'src_1',
    name: 'x.pdf',
    bytes: new Uint8Array(),
    pageCount: 1,
    pages: [{ width: 612, height: 792, rotation: 90 }],
  };
  const page: PageRef = { id: 'p1', sourceId: 'src_1', sourceIndex: 0, rotation: 90, annotations: [] };

  it('swaps display size for 90/270 and sums rotations', () => {
    const g = getPageGeometry(page, source);
    expect(g.totalRotation).toBe(180);
    expect(g.displayWidth).toBe(612);
    expect(g.displayHeight).toBe(792);
    const g2 = getPageGeometry({ ...page, rotation: 0 }, source);
    expect(g2.totalRotation).toBe(90);
    expect(g2.displayWidth).toBe(792);
    expect(g2.displayHeight).toBe(612);
  });

  it('round-trips canvas pixels and display points', () => {
    const g = getPageGeometry(page, source);
    const px = { x: 123.5, y: 456.25 };
    const display = canvasToDisplay(px, g, 1.5);
    expect(display.x).toBeCloseTo(px.x / 1.5);
    expect(display.y).toBeCloseTo(g.displayHeight - px.y / 1.5);
    const back = displayToCanvas(display, g, 1.5);
    expect(back.x).toBeCloseTo(px.x);
    expect(back.y).toBeCloseTo(px.y);
  });
});
