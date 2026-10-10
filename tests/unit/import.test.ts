import { describe, expect, it } from 'vitest';
import { createBlankPageSource, importFile } from '@/core/import';
import { detectFileKind, parseDataUrl } from '@/core/pdf-utils';
import { FAKE_WEBP, TINY_JPEG, TINY_PNG, makeEmptyPdf, makeEncryptedPdf, makePdf, toDataUrl } from '../helpers/make-pdf';
import { makePng } from '../helpers/make-png';
import { countImageXObjects, loadWithPdfLib, pageContent } from '../helpers/pdf-inspect';
import { getPageView } from '../helpers/pdfjs';

const text = (s: string) => new TextEncoder().encode(s);

describe('importFile — PDF', () => {
  it('reads page count, visible box sizes and normalized rotation', async () => {
    const bytes = await makePdf([
      { label: 'A' },
      { label: 'B', width: 595.28, height: 841.89, rotation: 90 },
      { label: 'C', cropBox: [100, 50, 300, 400] },
      { label: 'D', rotation: -90 },
      { label: 'E', rotation: 450 },
      { label: 'F', rotation: 180 },
    ]);
    const src = await importFile('fixture.pdf', bytes);

    expect(src.id).toMatch(/^src_/);
    expect(src.name).toBe('fixture.pdf');
    expect(src.bytes).toBe(bytes); // original bytes, not re-saved
    expect(src.pageCount).toBe(6);
    expect(src.pages).toHaveLength(6);
    expect(src.pages[0]).toEqual({ width: 612, height: 792, rotation: 0 });
    expect(src.pages[1]!.width).toBeCloseTo(595.28, 2);
    expect(src.pages[1]!.height).toBeCloseTo(841.89, 2);
    expect(src.pages[1]!.rotation).toBe(90);
    // CropBox wins over MediaBox for the visible size
    expect(src.pages[2]).toEqual({ width: 300, height: 400, rotation: 0 });
    expect(src.pages[3]!.rotation).toBe(270);
    expect(src.pages[4]!.rotation).toBe(90);
    expect(src.pages[5]!.rotation).toBe(180);
  });

  it('clips a CropBox that extends beyond the MediaBox', async () => {
    const bytes = await makePdf([{ label: 'A', cropBox: [-100, -100, 1000, 1000] }]);
    const src = await importFile('big-crop.pdf', bytes);
    expect(src.pages[0]).toEqual({ width: 612, height: 792, rotation: 0 });
  });

  it('agrees with pdf.js about the visible box', async () => {
    const bytes = await makePdf([{ label: 'A', cropBox: [20, 30, 200, 300] }]);
    const src = await importFile('crop.pdf', bytes);
    const view = await getPageView(bytes, 1);
    expect(src.pages[0]!.width).toBeCloseTo(view.view[2]! - view.view[0]!, 3);
    expect(src.pages[0]!.height).toBeCloseTo(view.view[3]! - view.view[1]!, 3);
  });

  it('detects a PDF by magic bytes regardless of the file extension', async () => {
    const bytes = await makePdf([{ label: 'A' }]);
    const src = await importFile('scan.dat', bytes);
    expect(src.pageCount).toBe(1);
  });

  it('rejects password protected PDFs with a friendly message', async () => {
    const bytes = await makeEncryptedPdf();
    await expect(importFile('secret.pdf', bytes)).rejects.toThrow(/password protected; remove the password first/);
  });

  it('rejects corrupt PDFs with a friendly message', async () => {
    await expect(importFile('broken.pdf', text('%PDF-1.7\nthis is not really a pdf'))).rejects.toThrow(
      /could not be read|no pages|damaged/,
    );
  });

  it('rejects PDFs without pages', async () => {
    await expect(importFile('empty.pdf', await makeEmptyPdf())).rejects.toThrow(/no pages/);
  });

  it('rejects empty files', async () => {
    await expect(importFile('nothing.pdf', new Uint8Array())).rejects.toThrow(/empty/);
  });
});

describe('importFile — images', () => {
  it('turns a PNG into a one-page portrait Letter PDF', async () => {
    const src = await importFile('pixel.png', TINY_PNG);
    expect(src.name).toBe('pixel.png');
    expect(src.pageCount).toBe(1);
    expect(src.pages).toEqual([{ width: 612, height: 792, rotation: 0 }]);

    const doc = await loadWithPdfLib(src.bytes);
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPage(0);
    expect(page.getSize()).toEqual({ width: 612, height: 792 });
    expect(countImageXObjects(doc)).toBe(1);
    // square image on a portrait page: 612×612, vertically centered
    const content = pageContent(doc, page);
    expect(content).toMatch(/612 0 0 612 0 0 cm/);
    expect(content).toMatch(/1 0 0 1 0 90 cm/);
  });

  it('uses a landscape page for a landscape image and fits it with no margin', async () => {
    const src = await importFile('wide.png', makePng(200, 100));
    expect(src.pages).toEqual([{ width: 792, height: 612, rotation: 0 }]);
    const doc = await loadWithPdfLib(src.bytes);
    const page = doc.getPage(0);
    expect(page.getSize()).toEqual({ width: 792, height: 612 });
    const content = pageContent(doc, page);
    expect(content).toMatch(/792 0 0 396 0 0 cm/); // scaled to full width
    expect(content).toMatch(/1 0 0 1 0 108 cm/); // (612 - 396) / 2
  });

  it('fits a tall image to the page height and centers horizontally', async () => {
    const src = await importFile('tall.png', makePng(10, 40));
    expect(src.pages).toEqual([{ width: 612, height: 792, rotation: 0 }]);
    const doc = await loadWithPdfLib(src.bytes);
    const content = pageContent(doc, doc.getPage(0));
    expect(content).toMatch(/198 0 0 792 0 0 cm/);
    expect(content).toMatch(/1 0 0 1 207 0 cm/); // (612 - 198) / 2
  });

  it('turns a JPEG into a one-page PDF', async () => {
    const src = await importFile('photo.jpg', TINY_JPEG);
    expect(src.pageCount).toBe(1);
    expect(src.pages[0]).toEqual({ width: 612, height: 792, rotation: 0 });
    const doc = await loadWithPdfLib(src.bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(countImageXObjects(doc)).toBe(1);
    expect(doc.getProducer()).toBe('PDF Editor');
  });

  it('falls back to the extension when there are no magic bytes', async () => {
    await expect(importFile('garbage.png', text('definitely not a png'))).rejects.toThrow(/could not be decoded as a PNG/);
  });

  it('rejects WebP with a hint to convert it', async () => {
    await expect(importFile('photo.webp', FAKE_WEBP)).rejects.toThrow(/WebP.*PNG/);
  });

  it('rejects unknown file types', async () => {
    await expect(importFile('notes.txt', text('hello'))).rejects.toThrow(/not a supported file type/);
  });
});

describe('createBlankPageSource', () => {
  it('creates a one-page blank PDF of the requested size', async () => {
    const src = await createBlankPageSource(595.28, 841.89);
    expect(src.name).toBe('Blank page');
    expect(src.pageCount).toBe(1);
    expect(src.pages).toEqual([{ width: 595.28, height: 841.89, rotation: 0 }]);
    const doc = await loadWithPdfLib(src.bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(595.28, 2);
    expect(height).toBeCloseTo(841.89, 2);
  });

  it('rejects non-positive sizes', async () => {
    await expect(createBlankPageSource(0, 100)).rejects.toThrow(/positive/);
    await expect(createBlankPageSource(100, Number.NaN)).rejects.toThrow(/positive/);
  });
});

describe('pdf-utils', () => {
  it('detects kinds by magic bytes, then by extension', async () => {
    expect(detectFileKind(await makePdf([{ label: 'A' }]), 'x.bin')).toBe('pdf');
    expect(detectFileKind(TINY_PNG, 'x.bin')).toBe('png');
    expect(detectFileKind(TINY_JPEG, 'x.bin')).toBe('jpeg');
    expect(detectFileKind(FAKE_WEBP, 'x.bin')).toBe('webp');
    expect(detectFileKind(text('zzz'), 'doc.PDF')).toBe('pdf');
    expect(detectFileKind(text('zzz'), 'pic.JPEG')).toBe('jpeg');
    expect(detectFileKind(text('zzz'), 'pic.jpg')).toBe('jpeg');
    expect(detectFileKind(text('zzz'), 'pic.png')).toBe('png');
    expect(detectFileKind(text('zzz'), 'pic.gif')).toBe('unknown');
    expect(detectFileKind(text('zzz'), 'README')).toBe('unknown');
  });

  it('parses base64 data URLs', () => {
    const parsed = parseDataUrl(toDataUrl(TINY_PNG, 'image/png'));
    expect(parsed.mime).toBe('image/png');
    expect(parsed.bytes).toEqual(TINY_PNG);
    expect(() => parseDataUrl('not a data url')).toThrow(/invalid data URL/);
  });
});
