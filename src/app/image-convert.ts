/**
 * Browser-side image normalisation. pdf-lib can only embed PNG and JPEG, so
 * other raster formats the browser can decode (WebP, GIF, BMP, AVIF...) are
 * re-encoded to PNG before import.
 */

const NATIVE_TYPES = new Set(['image/png', 'image/jpeg']);

export function needsConversion(name: string, type?: string): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return false;
  if (type && NATIVE_TYPES.has(type)) return false;
  return lower.endsWith('.webp') || lower.endsWith('.gif') || lower.endsWith('.bmp') || lower.endsWith('.avif') ||
    (type?.startsWith('image/') ?? false);
}

/** Decode any browser-supported image and re-encode it as PNG bytes. */
export async function convertImageToPng(blob: Blob): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context');
    ctx.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('PNG encoding failed');
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

export function pngName(name: string): string {
  return name.replace(/\.[^.]+$/, '') + '.png';
}
