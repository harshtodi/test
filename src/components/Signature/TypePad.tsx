import { useEffect, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';

/** Script-like font stack used for typed signatures. */
export const SIGNATURE_FONT_STACK =
  '"Brush Script MT", "Segoe Script", "Snell Roundhand", "URW Chancery L", "Apple Chancery", "Comic Sans MS", cursive';
export const TYPE_FONT_SIZE = 56;
const TYPE_PAD_X = 28;
const TYPE_MIN_WIDTH = 320;
const TYPE_HEIGHT = 110;

export const TYPE_COLORS: { name: string; label: string; css: string }[] = [
  { name: 'black', label: 'Black', css: '#111111' },
  { name: 'blue', label: 'Blue', css: '#1d4ed8' },
];

function pixelRatio(): number {
  return typeof window !== 'undefined' ? Math.max(1, Math.min(4, window.devicePixelRatio || 1)) : 1;
}

/**
 * Render `text` into `canvas` in the signature font. The canvas is resized to
 * fit the text (DPR aware) and left transparent when the text is blank.
 * Returns true when something was drawn.
 */
export function renderTypedSignature(canvas: HTMLCanvasElement, text: string, color: string): boolean {
  const dpr = pixelRatio();
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const font = `${TYPE_FONT_SIZE}px ${SIGNATURE_FONT_STACK}`;
  ctx.font = font;
  const trimmed = text.trim();
  const measured = trimmed ? ctx.measureText(trimmed).width : 0;
  const cssW = Math.max(TYPE_MIN_WIDTH, Math.ceil(measured + TYPE_PAD_X * 2));
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(TYPE_HEIGHT * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${TYPE_HEIGHT}px`;
  // resizing resets the context state
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, TYPE_HEIGHT);
  if (!trimmed) return false;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText(trimmed, TYPE_PAD_X, TYPE_HEIGHT * 0.66);
  return true;
}

export interface TypePadProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onInkChange: (hasInk: boolean) => void;
}

/** Typed signature: a text field with a live canvas preview in a script font. */
export function TypePad({ canvasRef, onInkChange }: TypePadProps) {
  const [text, setText] = useState('');
  const [color, setColor] = useState(TYPE_COLORS[0]!.css);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const draw = () => {
      if (cancelled) return;
      onInkChange(renderTypedSignature(canvas, text, color));
    };
    draw();
    // Re-render once web fonts (if any) have finished loading so the preview
    // and the exported image use the same glyphs.
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    void fonts?.ready?.then(draw);
    return () => {
      cancelled = true;
    };
  }, [canvasRef, text, color, onInkChange]);

  return (
    <div className="sig-pad">
      <input
        className="sig-text-input"
        data-testid="sig-type-input"
        type="text"
        placeholder="Type your name"
        aria-label="Signature text"
        autoComplete="name"
        autoFocus
        maxLength={60}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="sig-canvas-wrap sig-type-wrap">
        <canvas ref={canvasRef} className="sig-canvas sig-type-canvas" data-testid="sig-type-canvas" role="img" aria-label="Signature preview" />
        {!text.trim() && (
          <span className="sig-placeholder" aria-hidden="true">
            Preview
          </span>
        )}
      </div>
      <div className="sig-controls">
        <div className="sig-swatches" role="radiogroup" aria-label="Ink color">
          {TYPE_COLORS.map((c) => (
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
      </div>
    </div>
  );
}
