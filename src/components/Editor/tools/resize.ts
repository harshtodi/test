/**
 * Resize-handle geometry for rectangle and image annotations. Pure.
 *
 * Corners are named in display space, which also matches the screen:
 * `n` = top edge (larger y), `s` = bottom, `w` = left, `e` = right.
 */
import type { Point } from '@/core/types';
import type { Rect } from '@/core/geometry';

export type Corner = 'nw' | 'ne' | 'sw' | 'se';
export const CORNERS: readonly Corner[] = ['nw', 'ne', 'sw', 'se'];

/** On-screen size of a resize handle (CSS px). Divide by the scale for points. */
export const HANDLE_SIZE_PX = 9;

export function cornerPoint(box: Rect, corner: Corner): Point {
  const x = corner === 'ne' || corner === 'se' ? box.x + box.width : box.x;
  const y = corner === 'nw' || corner === 'ne' ? box.y + box.height : box.y;
  return { x, y };
}

export function oppositeCorner(corner: Corner): Corner {
  switch (corner) {
    case 'nw':
      return 'se';
    case 'ne':
      return 'sw';
    case 'sw':
      return 'ne';
    case 'se':
      return 'nw';
  }
}

/**
 * Which corner handle (if any) `p` is over. `handleSize` is the handle's side
 * in points (HANDLE_SIZE_PX / scale); a little slop is added for touch.
 * When handles overlap (tiny boxes) the nearest corner wins.
 */
export function hitCorner(box: Rect, p: Point, handleSize: number, slop = 2): Corner | null {
  const half = handleSize / 2 + slop;
  let best: Corner | null = null;
  let bestDist = Infinity;
  for (const corner of CORNERS) {
    const c = cornerPoint(box, corner);
    const dx = Math.abs(p.x - c.x);
    const dy = Math.abs(p.y - c.y);
    if (dx <= half && dy <= half) {
      const d = Math.hypot(dx, dy);
      if (d < bestDist) {
        bestDist = d;
        best = corner;
      }
    }
  }
  return best;
}

export interface ResizeOptions {
  /** Keep the original aspect ratio (images). */
  keepAspect?: boolean;
  /** Smallest allowed width/height in points. */
  minSize?: number;
}

/**
 * New box when the `corner` handle of `box` is dragged to `pointer`. The
 * opposite corner stays anchored; the box never flips (it shrinks to
 * `minSize` instead).
 */
export function resizeBox(box: Rect, corner: Corner, pointer: Point, options: ResizeOptions = {}): Rect {
  const minSize = options.minSize ?? 1;
  const anchor = cornerPoint(box, oppositeCorner(corner));
  const east = corner === 'ne' || corner === 'se';
  const north = corner === 'nw' || corner === 'ne';
  // Measured in the corner's own direction, so crossing the anchor yields 0 (then minSize), not a mirrored box.
  let width = Math.max(0, east ? pointer.x - anchor.x : anchor.x - pointer.x);
  let height = Math.max(0, north ? pointer.y - anchor.y : anchor.y - pointer.y);
  if (options.keepAspect && box.width > 0 && box.height > 0) {
    let k = Math.max(width / box.width, height / box.height);
    k = Math.max(k, minSize / box.width, minSize / box.height);
    width = box.width * k;
    height = box.height * k;
  } else {
    width = Math.max(minSize, width);
    height = Math.max(minSize, height);
  }
  return {
    x: east ? anchor.x : anchor.x - width,
    y: north ? anchor.y : anchor.y - height,
    width,
    height,
  };
}

/** CSS cursor for a corner handle. */
export function cursorForCorner(corner: Corner): 'nwse-resize' | 'nesw-resize' {
  return corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize';
}
