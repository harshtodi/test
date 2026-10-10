import type { PageGeometry, PageRef, Point, Rotation, SourceDoc } from './types';

export function normalizeRotation(deg: number): Rotation {
  const r = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return r as Rotation;
}

export function addRotation(a: Rotation, delta: number): Rotation {
  return normalizeRotation(a + delta);
}

/** Geometry of a page as it should be displayed (source rotation + user rotation). */
export function getPageGeometry(page: PageRef, source: SourceDoc): PageGeometry {
  const info = source.pages[page.sourceIndex];
  if (!info) {
    throw new Error(`Page index ${page.sourceIndex} out of range for source ${source.name}`);
  }
  const totalRotation = addRotation(info.rotation, page.rotation);
  const swap = totalRotation === 90 || totalRotation === 270;
  return {
    width: info.width,
    height: info.height,
    totalRotation,
    displayWidth: swap ? info.height : info.width,
    displayHeight: swap ? info.width : info.height,
  };
}

/**
 * Convert a point in canvas pixels (origin top-left, y down) to display space
 * (points, origin bottom-left, y up). `scale` is canvas pixels per point.
 */
export function canvasToDisplay(
  pt: Point,
  geometry: Pick<PageGeometry, 'displayHeight'>,
  scale: number,
): Point {
  return { x: pt.x / scale, y: geometry.displayHeight - pt.y / scale };
}

/** Inverse of {@link canvasToDisplay}. */
export function displayToCanvas(
  pt: Point,
  geometry: Pick<PageGeometry, 'displayHeight'>,
  scale: number,
): Point {
  return { x: pt.x * scale, y: (geometry.displayHeight - pt.y) * scale };
}

/** Affine matrix [a b c d e f] with x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Matrix = [number, number, number, number, number, number];

/**
 * Matrix mapping display space (rotated page, origin bottom-left of the view
 * box) to PDF user space, for a page whose visible box is
 * [x0, y0, x1, y1] and whose total rotation is `rotation`.
 *
 * Display rotation is clockwise, matching the PDF /Rotate semantics.
 */
export function displayToUserMatrix(
  box: { x0: number; y0: number; x1: number; y1: number },
  rotation: Rotation,
): Matrix {
  const { x0, y0, x1, y1 } = box;
  switch (rotation) {
    case 0:
      return [1, 0, 0, 1, x0, y0];
    case 90:
      // displayed bottom-left = unrotated bottom-right; display +x → user +y; display +y → user −x
      return [0, 1, -1, 0, x1, y0];
    case 180:
      return [-1, 0, 0, -1, x1, y1];
    case 270:
      // displayed bottom-left = unrotated top-left; display +x → user −y; display +y → user +x
      return [0, -1, 1, 0, x0, y1];
  }
}

export function applyMatrix(m: Matrix, p: Point): Point {
  const [a, b, c, d, e, f] = m;
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Normalize a rectangle given by two corners so width/height are positive. */
export function rectFromPoints(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function pointInRect(p: Point, r: Rect, pad = 0): boolean {
  return p.x >= r.x - pad && p.x <= r.x + r.width + pad && p.y >= r.y - pad && p.y <= r.y + r.height + pad;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Distance from point p to segment ab. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = clamp(t, 0, 1);
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}
