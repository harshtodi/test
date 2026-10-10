/**
 * The import/save actions against the real store: drop order under
 * concurrency, the image conversion decision (magic bytes, EXIF orientation)
 * and the save re-entrancy guard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '@/state/store';
import { openFiles, saveDocument } from '@/app/actions';
import { jpegExifOrientation, needsConversion } from '@/app/image-convert';
import { FAKE_WEBP, TINY_JPEG, TINY_PNG, makePdf } from '../helpers/make-pdf';

const S = () => useEditorStore.getState();
const reset = () => useEditorStore.setState(useEditorStore.getInitialState(), true);

/** A File-like object; `delay` makes arrayBuffer() resolve later (a big file still being read). */
function fakeFile(name: string, type: string, bytes: Uint8Array, delay = 0): File {
  const buffer = () => bytes.slice().buffer;
  return {
    name,
    type,
    arrayBuffer: () => (delay ? new Promise<ArrayBuffer>((r) => setTimeout(() => r(buffer()), delay)) : Promise.resolve(buffer())),
  } as unknown as File;
}

/** Splice an APP1 Exif segment carrying only an Orientation tag into a JPEG. */
function withExifOrientation(jpeg: Uint8Array, orientation: number, bigEndian = false): Uint8Array {
  const tiff = bigEndian
    ? [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
    : [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const length = exif.length + 2;
  return Uint8Array.from([...jpeg.subarray(0, 2), 0xff, 0xe1, length >> 8, length & 0xff, ...exif, ...jpeg.subarray(2)]);
}

const sourceNames = () => S().pages.map((p) => S().sources[p.sourceId]!.name);

beforeEach(reset);
afterEach(() => vi.unstubAllGlobals());

describe('openFiles ordering', () => {
  it('keeps drop order when an earlier batch is still being read', async () => {
    const slow = fakeFile('first-drop.pdf', 'application/pdf', await makePdf([{ label: 'slow' }]), 120);
    const fast = fakeFile('second-drop.pdf', 'application/pdf', await makePdf([{ label: 'fast' }]));
    await Promise.all([openFiles([slow]), openFiles([fast])]);
    expect(sourceNames()).toEqual(['first-drop.pdf', 'second-drop.pdf']);
  });

  it('a failed batch does not block the next one', async () => {
    await openFiles([fakeFile('broken.pdf', 'application/pdf', new TextEncoder().encode('%PDF-1.7 garbage'))]);
    expect(S().notice?.message).toMatch(/broken\.pdf/);
    await openFiles([fakeFile('ok.pdf', 'application/pdf', await makePdf([{ label: 'ok' }]))]);
    expect(sourceNames()).toEqual(['ok.pdf']);
  });

  it('reports the import as busy while it runs and clears it afterwards', async () => {
    const run = openFiles([fakeFile('big.pdf', 'application/pdf', await makePdf([{ label: 'big' }]), 80)]);
    await new Promise((r) => setTimeout(r, 10));
    expect(S().busy).toBe('importing');
    await run;
    expect(S().busy).toBeNull();
    expect(S().pages).toHaveLength(1);
  });
});

describe('image conversion decision', () => {
  it('needsConversion trusts magic bytes over the extension', () => {
    expect(needsConversion('photo.jpg', 'image/jpeg', FAKE_WEBP)).toBe(true);
    expect(needsConversion('pic.jpg', 'image/jpeg', TINY_PNG)).toBe(false);
    expect(needsConversion('pic.jpeg', 'image/jpeg', TINY_JPEG)).toBe(false);
    expect(needsConversion('pic.webp', 'image/webp')).toBe(true);
    expect(needsConversion('pic.gif')).toBe(true);
    expect(needsConversion('pic.png')).toBe(false);
  });

  it('routes a WebP that claims to be a JPEG through the converter', async () => {
    vi.stubGlobal('createImageBitmap', () => {
      throw new Error('CONVERTER_CALLED');
    });
    await openFiles([fakeFile('photo.jpg', 'image/jpeg', FAKE_WEBP)]);
    expect(S().notice?.message).toContain('CONVERTER_CALLED');
    expect(S().notice?.message).not.toMatch(/must be converted/);
  });

  it('re-encodes a JPEG with an EXIF orientation and embeds a plain one directly', async () => {
    vi.stubGlobal('createImageBitmap', () => {
      throw new Error('CONVERTER_CALLED');
    });
    await openFiles([fakeFile('upright.jpg', 'image/jpeg', TINY_JPEG)]);
    expect(S().notice).toBeNull();
    expect(S().pages).toHaveLength(1);
    await openFiles([fakeFile('rotated.jpg', 'image/jpeg', withExifOrientation(TINY_JPEG, 6))]);
    expect(S().notice?.message).toContain('rotated.jpg: CONVERTER_CALLED');
    expect(S().pages).toHaveLength(1);
  });

  it('jpegExifOrientation reads tag 0x0112 in either byte order and defaults to 1', () => {
    expect(jpegExifOrientation(TINY_JPEG)).toBe(1);
    expect(jpegExifOrientation(withExifOrientation(TINY_JPEG, 6))).toBe(6);
    expect(jpegExifOrientation(withExifOrientation(TINY_JPEG, 3, true))).toBe(3);
    expect(jpegExifOrientation(withExifOrientation(TINY_JPEG, 1))).toBe(1);
    expect(jpegExifOrientation(withExifOrientation(TINY_JPEG, 9))).toBe(1); // out of range
    expect(jpegExifOrientation(withExifOrientation(TINY_JPEG, 6).subarray(0, 20))).toBe(1); // truncated
    expect(jpegExifOrientation(TINY_PNG)).toBe(1);
    expect(jpegExifOrientation(new Uint8Array(0))).toBe(1);
    // a subarray with a non-zero byteOffset must be read relative to itself
    const padded = Uint8Array.from([0, 0, 0, ...withExifOrientation(TINY_JPEG, 8)]).subarray(3);
    expect(jpegExifOrientation(padded)).toBe(8);
  });
});

describe('saveDocument re-entrancy', () => {
  it('ignores a save while one is running and refuses to save mid-import', async () => {
    await openFiles([fakeFile('doc.pdf', 'application/pdf', await makePdf([{ label: 'x' }]))]);
    S().setBusy('saving');
    expect(await saveDocument()).toBe(false);
    expect(S().notice).toBeNull();
    S().setBusy('importing');
    expect(await saveDocument()).toBe(false);
    expect(S().notice?.message).toMatch(/importing/i);
  });

  it('always clears the busy flag, even when the platform save fails', async () => {
    await openFiles([fakeFile('doc.pdf', 'application/pdf', await makePdf([{ label: 'x' }]))]);
    // no `window` in Node: the web platform's saveFile throws after the export
    expect(await saveDocument()).toBe(false);
    expect(S().notice?.message).toMatch(/^Save failed/);
    expect(S().busy).toBeNull();
  });
});
