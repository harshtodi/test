/**
 * Browser-side image normalisation. pdf-lib can only embed PNG and JPEG, so
 * other raster formats the browser can decode (WebP, GIF, BMP, AVIF...) are
 * re-encoded to PNG before import. JPEGs that rely on an EXIF orientation tag
 * are re-encoded upright, because PDF viewers (and pdf-lib) ignore EXIF while
 * every browser, file manager and phone honours it.
 */
import { detectFileKind } from '@/core/pdf-utils';

const NATIVE_TYPES = new Set(['image/png', 'image/jpeg']);

/**
 * Whether the file must be re-encoded to PNG before import. Decided from the
 * extension and MIME type the file claims; when `bytes` are given the magic
 * bytes win, so a WebP that was renamed to .jpg is still converted.
 */
export function needsConversion(name: string, type?: string, bytes?: Uint8Array): boolean {
  if (bytes && detectFileKind(bytes, name) === 'webp') return true;
  const lower = name.toLowerCase();
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return false;
  if (type && NATIVE_TYPES.has(type)) return false;
  return lower.endsWith('.webp') || lower.endsWith('.gif') || lower.endsWith('.bmp') || lower.endsWith('.avif') ||
    (type?.startsWith('image/') ?? false);
}

/** Decode any browser-supported image and re-encode it as PNG bytes. */
export function convertImageToPng(blob: Blob): Promise<Uint8Array> {
  return reencode(blob, 'image/png');
}

/**
 * Decode a JPEG with its EXIF orientation applied and re-encode it as a plain
 * JPEG (no EXIF), so the pixels are upright wherever the file ends up.
 */
export function convertImageToJpeg(blob: Blob): Promise<Uint8Array> {
  return reencode(blob, 'image/jpeg', 0.92);
}

async function reencode(blob: Blob, mime: 'image/png' | 'image/jpeg', quality?: number): Promise<Uint8Array> {
  // Chromium applies the EXIF orientation while decoding; ask for it explicitly.
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context');
    ctx.drawImage(bitmap, 0, 0);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
    if (!out) throw new Error(`${mime === 'image/png' ? 'PNG' : 'JPEG'} encoding failed`);
    return new Uint8Array(await out.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

export function pngName(name: string): string {
  return name.replace(/\.[^.]+$/, '') + '.png';
}

export { jpegExifOrientation } from '@/core/import';
