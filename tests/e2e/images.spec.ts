import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { openApp, uploadFiles, expectPageCount, saveAndDownload, imageXObjectSizes, paintedImage, withExifOrientation } from './helpers';

test.describe('image import', () => {
  test('a JPEG with an EXIF orientation lands upright on a page of the right orientation', async ({ page }) => {
    await openApp(page);
    // 200×300 portrait pixels, Orientation=6: shown by the OS as a 300×200 landscape photo with the red half on the right
    const photo = withExifOrientation(await paintedImage(page, 'image/jpeg'), 6);
    await uploadFiles(page, [{ name: 'photo.jpg', bytes: photo, mimeType: 'image/jpeg' }]);
    await expectPageCount(page, 1);
    await expect(page.getByTestId('notice')).toHaveCount(0);

    const canvas = page.getByTestId('page-canvas');
    await expect(canvas).toHaveAttribute('data-render-status', 'done');
    const sample = await canvas.evaluate((el: HTMLCanvasElement) => {
      const ctx = el.getContext('2d')!;
      const px = (fx: number, fy: number) =>
        Array.from(ctx.getImageData(Math.round(el.width * fx), Math.round(el.height * fy), 1, 1).data.slice(0, 3));
      return { left: px(0.3, 0.5), right: px(0.7, 0.5) };
    });
    expect(sample.right[0]).toBeGreaterThan(180); // red
    expect(sample.right[2]).toBeLessThan(80);
    expect(sample.left[2]).toBeGreaterThan(180); // blue
    expect(sample.left[0]).toBeLessThan(80);

    const bytes = await saveAndDownload(page);
    const doc = await PDFDocument.load(bytes);
    expect(Math.round(doc.getPage(0).getWidth())).toBe(792);
    expect(Math.round(doc.getPage(0).getHeight())).toBe(612);
    expect(await imageXObjectSizes(bytes)).toEqual([{ width: 300, height: 200 }]);
  });

  test('WebP images are converted, even when the file claims to be a JPEG', async ({ page }) => {
    await openApp(page);
    const webp = await paintedImage(page, 'image/webp');
    await uploadFiles(page, [
      { name: 'renamed.jpg', bytes: webp, mimeType: 'image/jpeg' },
      { name: 'real.webp', bytes: webp, mimeType: 'image/webp' },
    ]);
    await expectPageCount(page, 2);
    await expect(page.getByTestId('notice')).toHaveCount(0);
    const bytes = await saveAndDownload(page);
    const doc = await PDFDocument.load(bytes);
    for (const pg of doc.getPages()) {
      expect(Math.round(pg.getWidth())).toBe(612);
      expect(Math.round(pg.getHeight())).toBe(792);
    }
    expect(await imageXObjectSizes(bytes)).toEqual([
      { width: 200, height: 300 },
      { width: 200, height: 300 },
    ]);
  });
});
