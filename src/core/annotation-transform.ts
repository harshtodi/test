import type { Annotation, Point } from './types';

/**
 * Re-map an annotation when its page is rotated by 90° clockwise, so that it
 * stays attached to the same content. `width`/`height` are the page's display
 * size BEFORE the rotation. After the rotation the display size is swapped.
 *
 * Derivation: user space is fixed; display→user is M_R (geometry.ts). For a
 * point p in the old display space, the new display point is
 * M_{R+90}^{-1}(M_R(p)) = (y, width - x).
 */
export function rotatePoint90cw(p: Point, width: number): Point {
  return { x: p.y, y: width - p.x };
}

export function rotateAnnotation90cw(a: Annotation, width: number): Annotation {
  switch (a.type) {
    case 'ink':
      return { ...a, strokes: a.strokes.map((s) => s.map((p) => rotatePoint90cw(p, width))) };
    case 'rect':
    case 'image':
      // bottom-left anchored box: corners (x, y) and (x+w, y+h) map to (y, W-x) and (y+h, W-x-w)
      return { ...a, x: a.y, y: width - a.x - a.width, width: a.height, height: a.width };
    case 'text':
      // text stays upright for the viewer; keep its top-left anchored to the same content point
      return { ...a, ...rotatePoint90cw({ x: a.x, y: a.y }, width) };
  }
}

/**
 * Rotate an annotation by any multiple of 90° (positive = clockwise) given the
 * page's display size before the rotation.
 */
export function rotateAnnotation(a: Annotation, deltaDegrees: number, width: number, height: number): Annotation {
  const steps = (((Math.round(deltaDegrees / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  let out = a;
  let w = width;
  let h = height;
  for (let i = 0; i < steps; i++) {
    out = rotateAnnotation90cw(out, w);
    [w, h] = [h, w];
  }
  return out;
}
