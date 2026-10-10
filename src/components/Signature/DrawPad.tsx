import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { acceptSample, drawLatestSegment, drawStroke, finishStroke } from './stroke';
import type { StrokePoint, StrokeStyle } from './stroke';

/** CSS size of the drawing surface. The bitmap is scaled by the device pixel ratio. */
export const DRAW_WIDTH = 600;
export const DRAW_HEIGHT = 200;

export const DRAW_COLORS: { name: string; label: string; css: string }[] = [
  { name: 'black', label: 'Black', css: '#111111' },
  { name: 'blue', label: 'Blue', css: '#1d4ed8' },
];
export const DRAW_WIDTHS = [2, 3, 4];

function pixelRatio(): number {
  return typeof window !== 'undefined' ? Math.max(1, Math.min(4, window.devicePixelRatio || 1)) : 1;
}

/** Pointer position in canvas bitmap pixels (handles CSS scaling and DPR). */
function toCanvasPoint(canvas: HTMLCanvasElement, e: { clientX: number; clientY: number }): StrokePoint {
  const rect = canvas.getBoundingClientRect();
  const sx = rect.width > 0 ? canvas.width / rect.width : 1;
  const sy = rect.height > 0 ? canvas.height / rect.height : 1;
  return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
}

export interface DrawPadProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onInkChange: (hasInk: boolean) => void;
}

/**
 * Freehand signature pad: a transparent, DPR-aware canvas with smooth round
 * strokes. Color and width apply to the whole drawing (it is one signature),
 * so changing them re-renders every stroke.
 */
export function DrawPad({ canvasRef, onInkChange }: DrawPadProps) {
  const [color, setColor] = useState(DRAW_COLORS[0]!.css);
  const [width, setWidth] = useState(3);
  const [strokeCount, setStrokeCount] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const strokesRef = useRef<StrokePoint[][]>([]);
  const currentRef = useRef<StrokePoint[] | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const dprRef = useRef(pixelRatio());

  const style = useCallback((): StrokeStyle => ({ color, width: width * dprRef.current }), [color, width]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const st = style();
    for (const stroke of strokesRef.current) drawStroke(ctx, stroke, st);
    if (currentRef.current) drawStroke(ctx, currentRef.current, st);
  }, [canvasRef, style]);

  // Size the bitmap once (and again if the DPR changes), keeping the drawing.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const apply = () => {
      const dpr = pixelRatio();
      dprRef.current = dpr;
      const w = Math.round(DRAW_WIDTH * dpr);
      const h = Math.round(DRAW_HEIGHT * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        const kx = canvas.width > 0 ? w / canvas.width : 1;
        const ky = canvas.height > 0 ? h / canvas.height : 1;
        if (kx !== 1 || ky !== 1) {
          strokesRef.current = strokesRef.current.map((s) => s.map((p) => ({ x: p.x * kx, y: p.y * ky })));
        }
        canvas.width = w;
        canvas.height = h;
      }
      redraw();
    };
    apply();
    const mq = window.matchMedia(`(resolution: ${dprRef.current}dppx)`);
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [canvasRef, redraw]);

  // Re-render when the style changes.
  useEffect(() => {
    redraw();
  }, [redraw]);

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (pointerIdRef.current !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const canvas = e.currentTarget;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* older engines */
    }
    pointerIdRef.current = e.pointerId;
    setDrawing(true);
    const p = toCanvasPoint(canvas, e);
    currentRef.current = [p];
    drawLatestSegment(ctx, currentRef.current, style());
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (pointerIdRef.current !== e.pointerId || !currentRef.current) return;
    const canvas = e.currentTarget;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    e.preventDefault();
    const native = e.nativeEvent;
    const samples: { clientX: number; clientY: number }[] =
      typeof native.getCoalescedEvents === 'function' && native.getCoalescedEvents().length > 0
        ? native.getCoalescedEvents()
        : [native];
    const st = style();
    for (const s of samples) {
      const p = toCanvasPoint(canvas, s);
      const pts = currentRef.current;
      if (!acceptSample(pts[pts.length - 1], p)) continue;
      pts.push(p);
      drawLatestSegment(ctx, pts, st);
    }
  };

  const endStroke = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    const canvas = e.currentTarget;
    const ctx = canvas.getContext('2d');
    const pts = currentRef.current;
    pointerIdRef.current = null;
    currentRef.current = null;
    setDrawing(false);
    try {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!pts || pts.length === 0) return;
    if (ctx) finishStroke(ctx, pts, style());
    strokesRef.current.push(pts);
    setStrokeCount(strokesRef.current.length);
    onInkChange(true);
  };

  const clear = () => {
    strokesRef.current = [];
    currentRef.current = null;
    setStrokeCount(0);
    redraw();
    onInkChange(false);
  };

  const undoStroke = () => {
    strokesRef.current.pop();
    setStrokeCount(strokesRef.current.length);
    redraw();
    onInkChange(strokesRef.current.length > 0);
  };

  return (
    <div className="sig-pad">
      <div className="sig-canvas-wrap sig-draw-wrap">
        <canvas
          ref={canvasRef}
          className="sig-canvas"
          data-testid="sig-canvas"
          role="img"
          aria-label="Signature drawing area. Draw your signature with the mouse, pen or finger."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onLostPointerCapture={endStroke}
          onContextMenu={(e) => e.preventDefault()}
        />
        {strokeCount === 0 && !drawing && (
          <span className="sig-placeholder" aria-hidden="true">
            Sign here
          </span>
        )}
        <span className="sig-baseline" aria-hidden="true" />
      </div>
      <div className="sig-controls">
        <div className="sig-swatches" role="radiogroup" aria-label="Ink color">
          {DRAW_COLORS.map((c) => (
            <button
              key={c.name}
              type="button"
              role="radio"
              aria-checked={color === c.css}
              className={`sig-swatch${color === c.css ? ' active' : ''}`}
              style={{ '--swatch': c.css } as CSSProperties}
              title={c.label}
              aria-label={`Ink color: ${c.label}`}
              data-testid={`sig-color-${c.name}`}
              onClick={() => setColor(c.css)}
            />
          ))}
        </div>
        <label className="sig-field">
          <span>Width</span>
          <select
            className="sig-select"
            data-testid="sig-width"
            aria-label="Pen width"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          >
            {DRAW_WIDTHS.map((w) => (
              <option key={w} value={w}>
                {w} px
              </option>
            ))}
          </select>
        </label>
        <span className="sig-controls-spacer" />
        <button type="button" className="btn" data-testid="sig-undo-stroke" disabled={strokeCount === 0} onClick={undoStroke}>
          Undo stroke
        </button>
        <button type="button" className="btn" data-testid="sig-clear" disabled={strokeCount === 0} onClick={clear}>
          Clear
        </button>
      </div>
    </div>
  );
}
