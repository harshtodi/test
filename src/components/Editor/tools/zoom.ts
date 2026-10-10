/** Pure zoom helpers for Ctrl/Cmd + wheel. */

/** Multiplier applied to the zoom for one wheel event. */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  // Normalize line/page deltas to roughly pixel-sized values.
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const factor = Math.exp(-px * 0.002);
  return Math.min(2, Math.max(0.5, factor));
}

export interface ZoomAnchor {
  /** Pointer position (viewport CSS px) when the zoom started. */
  clientX: number;
  clientY: number;
  /** The point under the pointer, in canvas points (y down) relative to the page's top-left. */
  px: number;
  py: number;
}

/**
 * Scroll delta that keeps `anchor` under the pointer after the page's
 * top-left moved to (`pageLeft`, `pageTop`) and the scale became `scale`.
 */
export function scrollDeltaForAnchor(
  anchor: ZoomAnchor,
  pageLeft: number,
  pageTop: number,
  scale: number,
): { dx: number; dy: number } {
  return { dx: pageLeft + anchor.px * scale - anchor.clientX, dy: pageTop + anchor.py * scale - anchor.clientY };
}
