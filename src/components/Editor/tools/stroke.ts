/**
 * Freehand stroke helpers (pen / highlighter). Pure, display-space points.
 */
import type { Point } from '@/core/types';
import type { Rect } from '@/core/geometry';

/** Points closer than this (in points) to the previous one are dropped. */
export const MIN_POINT_DISTANCE = 0.5;

/**
 * Append `p` to `points` unless it is within `minDistance` of the last point.
 * Mutates `points`; returns whether the point was added.
 */
export function appendStrokePoint(points: Point[], p: Point, minDistance = MIN_POINT_DISTANCE): boolean {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  const last = points[points.length - 1];
  if (last && Math.hypot(p.x - last.x, p.y - last.y) < minDistance) return false;
  points.push({ x: p.x, y: p.y });
  return true;
}

/** Light simplification: drop points closer than `minDistance` to their predecessor. */
export function simplifyStroke(points: Point[], minDistance = MIN_POINT_DISTANCE): Point[] {
  const out: Point[] = [];
  for (const p of points) appendStrokePoint(out, p, minDistance);
  return out;
}

export function translatePoints(points: Point[], dx: number, dy: number): Point[] {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** Axis-aligned bounds of a point set, optionally grown by `pad` on every side. */
export function pointsBounds(points: Point[], pad = 0): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX - pad, y: minY - pad, width: maxX - minX + 2 * pad, height: maxY - minY + 2 * pad };
}
