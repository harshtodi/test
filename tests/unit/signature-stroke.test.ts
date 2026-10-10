import { describe, expect, it } from 'vitest';
import {
  MIN_SAMPLE_DISTANCE,
  acceptSample,
  drawLatestSegment,
  drawStroke,
  finishStroke,
  midpoint,
} from '@/components/Signature/stroke';
import type { StrokeContext, StrokePoint } from '@/components/Signature/stroke';

type Op = [string, ...number[]];

/** Records the path commands a renderer issues, like a tiny canvas mock. */
function recorder(): StrokeContext & { ops: Op[] } {
  const ops: Op[] = [];
  return {
    ops,
    lineWidth: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
    strokeStyle: '',
    fillStyle: '',
    beginPath: () => ops.push(['beginPath']),
    moveTo: (x, y) => ops.push(['moveTo', x, y]),
    lineTo: (x, y) => ops.push(['lineTo', x, y]),
    quadraticCurveTo: (cx, cy, x, y) => ops.push(['quad', cx, cy, x, y]),
    arc: (x, y, r) => ops.push(['arc', x, y, r]),
    stroke: () => ops.push(['stroke']),
    fill: () => ops.push(['fill']),
  };
}

const style = { color: '#123456', width: 3 };
const pts: StrokePoint[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 20, y: 10 },
];

/** Keep only geometry (drop beginPath/stroke bookkeeping) for comparisons. */
const geometry = (ops: Op[]) => ops.filter((o) => o[0] !== 'beginPath' && o[0] !== 'stroke');

describe('stroke rendering', () => {
  it('applies round caps/joins and the style', () => {
    const ctx = recorder();
    drawStroke(ctx, pts, style);
    expect(ctx.lineCap).toBe('round');
    expect(ctx.lineJoin).toBe('round');
    expect(ctx.lineWidth).toBe(3);
    expect(ctx.strokeStyle).toBe('#123456');
  });

  it('draws a single tap as a filled dot of the pen width', () => {
    const ctx = recorder();
    drawStroke(ctx, [{ x: 5, y: 6 }], style);
    expect(ctx.ops).toEqual([['beginPath'], ['arc', 5, 6, 1.5], ['fill']]);
  });

  it('draws nothing for an empty stroke', () => {
    const ctx = recorder();
    drawStroke(ctx, [], style);
    drawLatestSegment(ctx, [], style);
    finishStroke(ctx, [], style);
    expect(ctx.ops).toEqual([]);
  });

  it('smooths through midpoints with the samples as control points', () => {
    const ctx = recorder();
    drawStroke(ctx, pts, style);
    const m01 = midpoint(pts[0]!, pts[1]!);
    const m12 = midpoint(pts[1]!, pts[2]!);
    const m23 = midpoint(pts[2]!, pts[3]!);
    expect(geometry(ctx.ops)).toEqual([
      ['moveTo', 0, 0],
      ['lineTo', m01.x, m01.y],
      ['quad', 10, 0, m12.x, m12.y],
      ['quad', 10, 10, m23.x, m23.y],
      ['lineTo', 20, 10],
    ]);
  });

  it('incremental drawing produces the same geometry as drawing the whole stroke', () => {
    const whole = recorder();
    drawStroke(whole, pts, style);

    const incremental = recorder();
    for (let n = 1; n <= pts.length; n++) drawLatestSegment(incremental, pts.slice(0, n), style);
    finishStroke(incremental, pts, style);

    // The incremental version starts with a filled dot for the first sample
    // (hidden under the round cap later); everything after it must match.
    const inc = geometry(incremental.ops).filter((o) => o[0] !== 'arc' && o[0] !== 'fill');
    // Incremental segments each start with a moveTo at the previous end point;
    // collapse those so the two traces compare like-for-like.
    const dedupe = (ops: Op[]) =>
      ops.filter((o, i) => {
        if (o[0] !== 'moveTo' || i === 0) return true;
        const prev = ops[i - 1]!;
        const [px, py] = prev.slice(-2);
        return !(px === o[1] && py === o[2]);
      });
    expect(dedupe(inc)).toEqual(geometry(whole.ops));
  });

  it('a two-point stroke is a straight line', () => {
    const ctx = recorder();
    drawStroke(ctx, pts.slice(0, 2), style);
    expect(geometry(ctx.ops)).toEqual([
      ['moveTo', 0, 0],
      ['lineTo', 10, 0],
    ]);
  });
});

describe('acceptSample', () => {
  it('accepts the first point and points far enough from the previous one', () => {
    expect(acceptSample(undefined, { x: 0, y: 0 })).toBe(true);
    expect(acceptSample({ x: 0, y: 0 }, { x: MIN_SAMPLE_DISTANCE, y: 0 })).toBe(true);
    expect(acceptSample({ x: 0, y: 0 }, { x: MIN_SAMPLE_DISTANCE / 2, y: 0 })).toBe(false);
    expect(acceptSample({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(false);
    expect(acceptSample({ x: 0, y: 0 }, { x: 0.2, y: 0.2 }, 0.1)).toBe(true);
  });
});
