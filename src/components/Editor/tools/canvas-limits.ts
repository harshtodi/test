/**
 * Keep the backing bitmap of the page canvas within what browsers allocate.
 * Chromium refuses canvases over 16384 px a side or ~268M px in area; we stay
 * well below that so zoomed-in large pages still render (just a bit softer).
 */
export interface CanvasLimits {
  maxSide: number;
  maxArea: number;
}

export const DEFAULT_CANVAS_LIMITS: CanvasLimits = { maxSide: 8192, maxArea: 48_000_000 };

/** Largest pixel ratio ≤ `pixelRatio` such that cssWidth×cssHeight at that ratio fits the limits. */
export function clampPixelRatio(
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
  limits: CanvasLimits = DEFAULT_CANVAS_LIMITS,
): number {
  if (!(cssWidth > 0) || !(cssHeight > 0)) return Math.max(0.1, pixelRatio);
  let ratio = pixelRatio > 0 && Number.isFinite(pixelRatio) ? pixelRatio : 1;
  ratio = Math.min(ratio, limits.maxSide / cssWidth, limits.maxSide / cssHeight);
  ratio = Math.min(ratio, Math.sqrt(limits.maxArea / (cssWidth * cssHeight)));
  return Math.max(0.1, ratio);
}
