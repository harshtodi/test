/**
 * Display space ↔ SVG overlay coordinates.
 *
 * The overlay SVG uses `viewBox="0 0 displayWidth displayHeight"`, so its user
 * units are PDF points, but SVG's y axis points down while display space
 * (see src/core/types.ts) has its origin at the bottom-left with y up. Every
 * shape is converted here before it is drawn, which keeps text and images
 * upright without nested flip transforms.
 */
import type { Point } from '@/core/types';
import type { Rect } from '@/core/geometry';

/** Compact number formatting for path data (2 decimals, no trailing zeros). */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, '');
}

/** Display-space point → SVG user units (y down). */
export function toSvgPoint(p: Point, displayHeight: number): Point {
  return { x: p.x, y: displayHeight - p.y };
}

/** SVG user units (y down) → display-space point. */
export function fromSvgPoint(p: Point, displayHeight: number): Point {
  return { x: p.x, y: displayHeight - p.y };
}

/** Display-space rect (bottom-left origin) → SVG rect (top-left origin). */
export function toSvgRect(r: Rect, displayHeight: number): Rect {
  return { x: r.x, y: displayHeight - r.y - r.height, width: r.width, height: r.height };
}

/**
 * SVG path data for one polyline stroke. A single point becomes a tiny
 * segment so round line caps render it as a dot (same trick as the exporter).
 */
export function strokePathData(points: Point[], displayHeight: number): string {
  const first = points[0];
  if (!first) return '';
  const p0 = toSvgPoint(first, displayHeight);
  if (points.length === 1) return `M ${fmt(p0.x)} ${fmt(p0.y)} l 0.01 0`;
  const parts = [`M ${fmt(p0.x)} ${fmt(p0.y)}`];
  for (let i = 1; i < points.length; i++) {
    const p = toSvgPoint(points[i]!, displayHeight);
    parts.push(`L ${fmt(p.x)} ${fmt(p.y)}`);
  }
  return parts.join(' ');
}
