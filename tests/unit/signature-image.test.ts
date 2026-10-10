import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALPHA_THRESHOLD,
  fitWithin,
  inkBounds,
  knockOutWhite,
  padBounds,
  trimmedSize,
} from '@/components/Signature/signature-image';

/** Build an RGBA buffer of `w`×`h` transparent pixels. */
function blank(w: number, h: number): Uint8ClampedArray {
  return new Uint8ClampedArray(w * h * 4);
}

function paint(data: Uint8ClampedArray, w: number, x: number, y: number, rgba: [number, number, number, number]): void {
  const i = (y * w + x) * 4;
  data[i] = rgba[0];
  data[i + 1] = rgba[1];
  data[i + 2] = rgba[2];
  data[i + 3] = rgba[3];
}

describe('inkBounds', () => {
  it('returns null for a blank canvas', () => {
    expect(inkBounds(blank(10, 4), 10, 4)).toBeNull();
  });

  it('returns null for empty or inconsistent dimensions', () => {
    expect(inkBounds(blank(0, 0), 0, 0)).toBeNull();
    expect(inkBounds(new Uint8ClampedArray(8), 10, 10)).toBeNull(); // too short
  });

  it('finds the tight bounding box of opaque pixels (exclusive max)', () => {
    const w = 20;
    const h = 10;
    const data = blank(w, h);
    paint(data, w, 3, 2, [0, 0, 0, 255]);
    paint(data, w, 15, 7, [0, 0, 0, 255]);
    paint(data, w, 9, 4, [0, 0, 0, 255]);
    expect(inkBounds(data, w, h)).toEqual({ x0: 3, y0: 2, x1: 16, y1: 8 });
  });

  it('ignores the anti-aliasing fringe below the alpha threshold', () => {
    const w = 8;
    const h = 8;
    const data = blank(w, h);
    paint(data, w, 0, 0, [0, 0, 0, DEFAULT_ALPHA_THRESHOLD]); // not counted (must exceed)
    paint(data, w, 7, 7, [0, 0, 0, 3]);
    paint(data, w, 4, 4, [0, 0, 0, DEFAULT_ALPHA_THRESHOLD + 1]);
    expect(inkBounds(data, w, h)).toEqual({ x0: 4, y0: 4, x1: 5, y1: 5 });
    // custom threshold
    expect(inkBounds(data, w, h, 0)).toEqual({ x0: 0, y0: 0, x1: 8, y1: 8 });
  });

  it('covers the whole image when every pixel is opaque (JPEG uploads)', () => {
    const w = 5;
    const h = 3;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    expect(inkBounds(data, w, h)).toEqual({ x0: 0, y0: 0, x1: 5, y1: 3 });
  });
});

describe('padBounds', () => {
  it('grows the box by the padding and clamps to the image', () => {
    const b = { x0: 3, y0: 2, x1: 16, y1: 8 };
    expect(padBounds(b, 8, 20, 10)).toEqual({ x0: 0, y0: 0, x1: 20, y1: 10 });
    expect(padBounds(b, 2, 20, 10)).toEqual({ x0: 1, y0: 0, x1: 18, y1: 10 });
    expect(padBounds(b, 0, 20, 10)).toEqual(b);
    expect(padBounds(b, -5, 20, 10)).toEqual(b); // negative padding is ignored
    expect(padBounds(b, 2.6, 20, 10)).toEqual({ x0: 0, y0: 0, x1: 19, y1: 10 }); // rounded
  });
});

describe('trimmedSize', () => {
  it('adds the padding on every side regardless of where the ink sits', () => {
    // ink touching the top-left corner of a 40x20 canvas still gets a full margin
    expect(trimmedSize({ x0: 0, y0: 0, x1: 30, y1: 10 }, 8)).toEqual({ width: 46, height: 26 });
    expect(trimmedSize({ x0: 3, y0: 2, x1: 16, y1: 8 }, 0)).toEqual({ width: 13, height: 6 });
    expect(trimmedSize({ x0: 3, y0: 2, x1: 16, y1: 8 }, 2.6)).toEqual({ width: 19, height: 12 }); // rounded
    expect(trimmedSize({ x0: 3, y0: 2, x1: 16, y1: 8 }, -4)).toEqual({ width: 13, height: 6 }); // never negative
  });
});

describe('knockOutWhite', () => {
  it('makes white transparent, keeps dark ink and fades the in-between', () => {
    const data = new Uint8ClampedArray(4 * 4);
    const px = (i: number, r: number, g: number, b: number) => {
      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = 255;
    };
    px(0, 255, 255, 255); // white
    px(1, 0, 0, 0); // black
    px(2, 240, 240, 240); // near white (above threshold 235)
    px(3, 220, 220, 220); // light grey inside the soft band (200..235)
    knockOutWhite(data);
    expect(data[3]).toBe(0);
    expect(data[7]).toBe(255);
    expect(data[11]).toBe(0);
    expect(data[15]).toBeGreaterThan(0);
    expect(data[15]).toBeLessThan(255);
  });

  it('uses the minimum channel so colored ink on white survives', () => {
    const data = new Uint8ClampedArray([30, 60, 200, 255]); // blue ink
    knockOutWhite(data);
    expect(data[3]).toBe(255);
  });
});

describe('fitWithin', () => {
  it('leaves small images alone and scales large ones proportionally', () => {
    expect(fitWithin(800, 300)).toEqual({ width: 800, height: 300 });
    expect(fitWithin(3200, 800)).toEqual({ width: 1600, height: 400 });
    expect(fitWithin(100, 4000, 1000)).toEqual({ width: 25, height: 1000 });
    expect(fitWithin(0, 0)).toEqual({ width: 1, height: 1 });
  });
});
