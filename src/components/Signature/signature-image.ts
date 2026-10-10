/**
 * Turning a signature canvas into a trimmed, transparent PNG.
 *
 * The pixel scanning helpers are pure (they work on any RGBA byte array) so
 * they are unit tested in Node; {@link trimCanvas} is the thin DOM wrapper the
 * dialog calls.
 */
import type { SignatureImage } from './signature-store';

export interface PixelBounds {
  /** Inclusive left/top. */
  x0: number;
  y0: number;
  /** Exclusive right/bottom. */
  x1: number;
  y1: number;
}

/** Alpha below this is treated as background (anti-aliasing fringe). */
export const DEFAULT_ALPHA_THRESHOLD = 8;

/**
 * Bounding box of all pixels whose alpha exceeds `alphaThreshold`, in an RGBA
 * buffer laid out like `ImageData.data`. Returns `null` for an empty image.
 */
export function inkBounds(
  data: ArrayLike<number>,
  width: number,
  height: number,
  alphaThreshold = DEFAULT_ALPHA_THRESHOLD,
): PixelBounds | null {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) return null;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const alpha = data[row + x * 4 + 3] ?? 0;
      if (alpha > alphaThreshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Grow a box by `padding` pixels on every side, clamped to the image. */
export function padBounds(b: PixelBounds, padding: number, width: number, height: number): PixelBounds {
  const p = Math.max(0, Math.round(padding));
  return {
    x0: Math.max(0, b.x0 - p),
    y0: Math.max(0, b.y0 - p),
    x1: Math.min(width, b.x1 + p),
    y1: Math.min(height, b.y1 + p),
  };
}

/**
 * Make near-white pixels transparent, in place. Used for scanned/photographed
 * signatures (JPEG has no alpha channel). Pixels whose minimum channel is at
 * or above `threshold` become fully transparent; slightly darker pixels fade
 * so the edge of the ink stays smooth.
 */
export function knockOutWhite(data: Uint8ClampedArray | number[], threshold = 235, softness = 35): void {
  const lo = threshold - softness;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const min = Math.min(r, g, b);
    if (min >= threshold) {
      data[i + 3] = 0;
    } else if (min > lo) {
      const keep = (threshold - min) / softness; // 0..1
      data[i + 3] = Math.round((data[i + 3] ?? 255) * keep);
    }
  }
}

/** True when nothing has been drawn (every pixel is transparent). */
export function isCanvasBlank(canvas: HTMLCanvasElement, alphaThreshold = DEFAULT_ALPHA_THRESHOLD): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width === 0 || canvas.height === 0) return true;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return inkBounds(data, canvas.width, canvas.height, alphaThreshold) === null;
}

/** Output size of {@link trimCanvas}: the ink box plus `padding` on every side. */
export function trimmedSize(bounds: PixelBounds, padding: number): { width: number; height: number } {
  const p = Math.max(0, Math.round(padding));
  return { width: bounds.x1 - bounds.x0 + 2 * p, height: bounds.y1 - bounds.y0 + 2 * p };
}

/**
 * Crop `canvas` to its ink bounding box and return a PNG data URL with a
 * transparent background and exactly `padding` transparent pixels on every
 * side (the margin is added even when the ink touches the canvas edge, so an
 * opaque upload or a tightly cropped image gets the same breathing room as a
 * drawing). Returns `null` when the canvas is blank.
 */
export function trimCanvas(canvas: HTMLCanvasElement, padding = 8): SignatureImage | null {
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width === 0 || canvas.height === 0) return null;
  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const bounds = inkBounds(image.data, width, height);
  if (!bounds) return null;
  const p = Math.max(0, Math.round(padding));
  const inkW = bounds.x1 - bounds.x0;
  const inkH = bounds.y1 - bounds.y0;
  const { width: outW, height: outH } = trimmedSize(bounds, p);
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const octx = out.getContext('2d');
  if (!octx) return null;
  octx.drawImage(canvas, bounds.x0, bounds.y0, inkW, inkH, p, p, inkW, inkH);
  return { dataUrl: out.toDataURL('image/png'), width: outW, height: outH };
}

/** Load an image file into an HTMLImageElement (rejects for undecodable files). */
export function loadImageFile(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The file could not be decoded as an image'));
    };
    img.src = url;
  });
}

/** Longest side (in pixels) an uploaded signature is scaled down to. */
export const MAX_UPLOAD_SIDE = 1600;

/** Size an image should be drawn at so its longest side is at most `maxSide`. */
export function fitWithin(width: number, height: number, maxSide = MAX_UPLOAD_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide || longest <= 0) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const k = maxSide / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}
