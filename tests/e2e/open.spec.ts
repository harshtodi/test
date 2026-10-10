import { test, expect } from '@playwright/test';
import {
  openApp,
  uploadFiles,
  uploadPdf,
  dropFiles,
  expectPageCount,
  makePdf,
  makeEncryptedPdf,
  TINY_PNG,
  pageTexts,
  saveAndDownload,
  downloadBytes,
} from './helpers';

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

  test('rejects a password-protected PDF with a clear message', async ({ page }) => {
    await openApp(page);
    await uploadFiles(page, [{ name: 'locked.pdf', bytes: await makeEncryptedPdf() }]);
    await expect(page.getByTestId('notice')).toContainText(/locked\.pdf.*password/i);
    await expect(page.getByTestId('empty-state')).toBeVisible();
  });

  test('deleting every page resets the document: the next file names the output and undo still works', async ({ page }) => {
    await openApp(page);
    await uploadPdf(page, 'alpha.pdf', [{ label: 'A1' }, { label: 'A2' }]);
    await expectPageCount(page, 2);
    await expect(page.getByTestId('tb-filename')).toContainText('alpha-edited.pdf');
    await page.getByTestId('tb-delete-page').click();
    await page.getByTestId('tb-delete-page').click();
    await expect(page.getByTestId('empty-state')).toBeVisible();
    // nothing left to lose: no unsaved-changes marker, but the deletion stays undoable
    await expect(page.getByTestId('tb-save')).toHaveAttribute('data-dirty', 'false');
    await expect(page.getByTestId('tb-undo')).toBeEnabled();

    await uploadPdf(page, 'bravo.pdf', [{ label: 'B1' }]);
    await expectPageCount(page, 1);
    await expect(page.getByTestId('tb-filename')).toContainText('bravo-edited.pdf');
    const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('ControlOrMeta+s')]);
    expect(download.suggestedFilename()).toBe('bravo-edited.pdf');
    expect(await pageTexts(await downloadBytes(download))).toEqual(['B1']);

    await page.getByTestId('tb-undo').click(); // the import of bravo
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await page.getByTestId('tb-undo').click(); // the deletion of A2
    await expectPageCount(page, 1);
    await page.getByTestId('tb-undo').click(); // the deletion of A1
    await expectPageCount(page, 2);
  });

  test('the drop overlay stays up while a file drag crosses element boundaries', async ({ page }) => {
    await openApp(page);
    const states = await page.evaluate(async () => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([1, 2, 3])], 'a.pdf', { type: 'application/pdf' }));
      const fire = (el: Element, type: string) =>
        el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      const settle = () => new Promise((r) => setTimeout(r, 50));
      const visible = () => document.querySelector('[data-testid="drop-overlay"]') !== null;
      const h1 = document.querySelector('.empty-card h1')!;
      const p = document.querySelector('.empty-card p')!;
      const out: Record<string, boolean> = {};
      fire(h1, 'dragenter');
      await settle();
      out.afterEnter = visible();
      // moving h1 → p: the browser fires dragenter on the new element before dragleave on the old one
      fire(p, 'dragenter');
      fire(h1, 'dragleave');
      await settle();
      out.afterCrossToP = visible();
      fire(h1, 'dragenter');
      fire(p, 'dragleave');
      await settle();
      out.afterCrossBack = visible();
      fire(h1, 'dragleave');
      await settle();
      out.afterLeavingWindow = visible();
      return out;
    });
    expect(states).toEqual({ afterEnter: true, afterCrossToP: true, afterCrossBack: true, afterLeavingWindow: false });
  });
});
