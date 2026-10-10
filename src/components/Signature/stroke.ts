/**
 * Smooth freehand stroke rendering for the signature pad.
 *
 * A stroke is a polyline of pointer samples. It is drawn as a chain of
 * quadratic curves whose end points are the midpoints between samples and
 * whose control points are the samples themselves, which rounds off the
 * corners of a jittery pointer trail. The drawing primitives are expressed as
 * a small interface so the code can be unit tested without a real canvas.
 */

export interface StrokePoint {
  x: number;
  y: number;
}

export interface StrokeStyle {
  /** CSS color. */
  color: string;
  /** Line width in canvas pixels. */
  width: number;
}

/** The subset of CanvasRenderingContext2D the stroke renderer needs. */
export interface StrokeContext {
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  stroke(): void;
  fill(): void;
}

export function midpoint(a: StrokePoint, b: StrokePoint): StrokePoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function applyStyle(ctx: StrokeContext, style: StrokeStyle): void {
  ctx.lineWidth = style.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = style.color;
  ctx.fillStyle = style.color;
}

/** A single tap: a filled dot of the stroke width. */
function drawDot(ctx: StrokeContext, p: StrokePoint, style: StrokeStyle): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, style.width / 2, 0, Math.PI * 2);
  ctx.fill();
}

/** Draw a whole stroke from scratch. */
export function drawStroke(ctx: StrokeContext, points: readonly StrokePoint[], style: StrokeStyle): void {
  const first = points[0];
  if (!first) return;
  applyStyle(ctx, style);
  if (points.length === 1) {
    drawDot(ctx, first, style);
    return;
  }
  const second = points[1]!;
  if (points.length === 2) {
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    ctx.lineTo(second.x, second.y);
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  let m = midpoint(first, second);
  ctx.lineTo(m.x, m.y);
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const next = points[i + 1]!;
    m = midpoint(p, next);
    ctx.quadraticCurveTo(p.x, p.y, m.x, m.y);
  }
  const last = points[points.length - 1]!;
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

/**
 * Incrementally draw the part of the stroke contributed by the newest point
 * (`points[points.length - 1]`). Calling this after every sample produces the
 * same picture as {@link drawStroke} on the finished stroke, without
 * re-rendering everything on each pointer move.
 */
export function drawLatestSegment(ctx: StrokeContext, points: readonly StrokePoint[], style: StrokeStyle): void {
  const n = points.length;
  const last = points[n - 1];
  if (!last) return;
  applyStyle(ctx, style);
  if (n === 1) {
    drawDot(ctx, last, style);
    return;
  }
  if (n === 2) {
    // first → midpoint(first, second); the rest of this segment is drawn by later calls
    const first = points[0]!;
    const m = midpoint(first, last);
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    ctx.lineTo(m.x, m.y);
    ctx.stroke();
    return;
  }
  const prev = points[n - 2]!;
  const prev2 = points[n - 3]!;
  const from = midpoint(prev2, prev);
  const to = midpoint(prev, last);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(prev.x, prev.y, to.x, to.y);
  ctx.stroke();
}

/** Close the trailing half-segment (last midpoint → last point) when a stroke ends. */
export function finishStroke(ctx: StrokeContext, points: readonly StrokePoint[], style: StrokeStyle): void {
  const n = points.length;
  if (n < 2) return;
  applyStyle(ctx, style);
  const prev = points[n - 2]!;
  const last = points[n - 1]!;
  const m = midpoint(prev, last);
  ctx.beginPath();
  ctx.moveTo(m.x, m.y);
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

/** Skip samples closer than this (canvas px) to the previous one; they only add noise. */
export const MIN_SAMPLE_DISTANCE = 0.75;

/** Whether `p` is far enough from `prev` to be worth keeping. */
export function acceptSample(prev: StrokePoint | undefined, p: StrokePoint, minDistance = MIN_SAMPLE_DISTANCE): boolean {
  if (!prev) return true;
  return Math.hypot(p.x - prev.x, p.y - prev.y) >= minDistance;
}
