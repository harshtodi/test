import { test, expect } from '@playwright/test';
import { openApp, uploadFiles, uploadPdf, dropFiles, expectPageCount, makePdf, TINY_PNG, pageTexts, saveAndDownload } from './helpers';

test.describe('opening files', () => {
  test('shows the empty state and opens a PDF via the file input', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await uploadPdf(page, 'three.pdf', [{ label: 'Alpha' }, { label: 'Bravo' }, { label: 'Charlie' }]);
    await expectPageCount(page, 3);
    await expect(page.getByTestId('empty-state')).toHaveCount(0);
    await expect(page.getByTestId('page-editor')).toBeVisible();
    await expect(page.getByTestId('page-canvas')).toBeVisible();
  });

  test('merges several files in the order given and derives the output name', async ({ page }) => {
    await openApp(page);
    await uploadFiles(page, [
      { name: 'first.pdf', bytes: await makePdf([{ label: 'One' }, { label: 'Two' }]) },
      { name: 'second.pdf', bytes: await makePdf([{ label: 'Three' }]) },
    ]);
    await expectPageCount(page, 3);
    await expect(page.getByTestId('tb-filename')).toContainText('first-edited.pdf');
    const bytes = await saveAndDownload(page);
    const texts = await pageTexts(bytes);
    expect(texts).toEqual(['One', 'Two', 'Three']);
  });

  test('accepts files dropped onto the window', async ({ page }) => {
    await openApp(page);
    await dropFiles(page, [{ name: 'dropped.pdf', bytes: await makePdf([{ label: 'Dropped' }, { label: 'Pages' }]) }]);
    await expectPageCount(page, 2);
    // dropping more appends
    await dropFiles(page, [{ name: 'more.pdf', bytes: await makePdf([{ label: 'More' }]) }]);
    await expectPageCount(page, 3);
  });

  test('converts a PNG image into a page', async ({ page }) => {
    await openApp(page);
    await uploadPdf(page, 'doc.pdf', [{ label: 'Doc' }]);
    await uploadFiles(page, [{ name: 'pixel.png', bytes: TINY_PNG, mimeType: 'image/png' }]);
    await expectPageCount(page, 2);
    const bytes = await saveAndDownload(page);
    const texts = await pageTexts(bytes);
    expect(texts[0]).toBe('Doc');
    expect(texts[1]).toBe('');
  });

  test('reports unsupported and corrupt files without crashing', async ({ page }) => {
    await openApp(page);
    await uploadFiles(page, [{ name: 'notes.txt', bytes: new TextEncoder().encode('hello'), mimeType: 'text/plain' }]);
    await expect(page.getByTestId('notice')).toContainText(/unsupported/i);
    await uploadFiles(page, [{ name: 'broken.pdf', bytes: new TextEncoder().encode('%PDF-1.7 garbage'), mimeType: 'application/pdf' }]);
    await expect(page.getByTestId('notice')).toContainText(/broken\.pdf/i);
    await expect(page.getByTestId('empty-state')).toBeVisible();
  });
});
