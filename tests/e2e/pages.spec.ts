import { test, expect, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { openApp, uploadPdf, expectPageCount, pageTexts, saveAndDownload, centerOf } from './helpers';

async function dragThumb(page: Page, fromIndex: number, toIndex: number) {
  const from = await centerOf(page, 'page-thumb', fromIndex);
  const to = await centerOf(page, 'page-thumb', toIndex);
  // land slightly past the target's centre in the drag direction so dnd-kit resolves the new slot
  const dir = toIndex > fromIndex ? 1 : -1;
  const vertical = Math.abs(to.y - from.y) >= Math.abs(to.x - from.x);
  const tx = vertical ? to.x : to.x + dir * to.box.width * 0.3;
  const ty = vertical ? to.y + dir * to.box.height * 0.3 : to.y;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
  await page.mouse.move(tx, ty, { steps: 15 });
  await page.waitForTimeout(100);
  await page.mouse.move(tx, ty + 1, { steps: 2 });
  await page.mouse.up();
}

test.describe('page management', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await uploadPdf(page, 'doc.pdf', [{ label: 'P1' }, { label: 'P2' }, { label: 'P3' }, { label: 'P4' }]);
    await expectPageCount(page, 4);
  });

  test('rearranges pages by dragging thumbnails', async ({ page }) => {
    // the grid view fits a 4-page document in one row, so no auto-scroll interferes
    await page.getByTestId('tb-view-grid').click();
    await expect(page.getByTestId('page-grid-grid')).toBeVisible();
    await dragThumb(page, 0, 2);
    await expect
      .poll(async () => pageTexts(await saveAndDownload(page)), { timeout: 20_000 })
      .toEqual(['P2', 'P3', 'P1', 'P4']);
  });

  test('deletes a page from the thumbnail actions and from the toolbar', async ({ page }) => {
    const thumb = page.getByTestId('page-thumb').nth(1);
    await thumb.hover();
    await thumb.getByTestId('thumb-delete').click();
    await expectPageCount(page, 3);
    // toolbar deletes the active page
    await page.getByTestId('page-thumb').nth(0).click();
    await page.getByTestId('tb-delete-page').click();
    await expectPageCount(page, 2);
    const texts = await pageTexts(await saveAndDownload(page));
    expect(texts).toEqual(['P3', 'P4']);
  });

  test('rotates a page and the rotation is written to the output', async ({ page }) => {
    const thumb = page.getByTestId('page-thumb').nth(0);
    await thumb.hover();
    await thumb.getByTestId('thumb-rotate-cw').click();
    const bytes = await saveAndDownload(page);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPage(1).getRotation().angle).toBe(0);
  });

  test('duplicates and inserts blank pages', async ({ page }) => {
    const thumb = page.getByTestId('page-thumb').nth(2);
    await thumb.hover();
    await thumb.getByTestId('thumb-duplicate').click();
    await expectPageCount(page, 5);
    await page.getByTestId('page-thumb').nth(0).click();
    await page.getByTestId('tb-insert-blank').click();
    await expectPageCount(page, 6);
    const texts = await pageTexts(await saveAndDownload(page));
    expect(texts).toEqual(['P1', '', 'P2', 'P3', 'P3', 'P4']);
  });

  test('undo and redo restore page operations', async ({ page }) => {
    const thumb = page.getByTestId('page-thumb').nth(0);
    await thumb.hover();
    await thumb.getByTestId('thumb-delete').click();
    await expectPageCount(page, 3);
    await page.getByTestId('tb-undo').click();
    await expectPageCount(page, 4);
    await page.getByTestId('tb-redo').click();
    await expectPageCount(page, 3);
    await page.keyboard.press('ControlOrMeta+z');
    await expectPageCount(page, 4);
  });

  test('grid view supports multi-select and bulk delete', async ({ page }) => {
    await page.getByTestId('tb-view-grid').click();
    await expect(page.getByTestId('page-grid-grid')).toBeVisible();
    await page.getByTestId('page-thumb').nth(0).click();
    await page.getByTestId('page-thumb').nth(2).click({ modifiers: ['ControlOrMeta'] });
    await page.getByTestId('grid-delete').click();
    await expectPageCount(page, 2);
    const texts = await pageTexts(await saveAndDownload(page));
    expect(texts).toEqual(['P2', 'P4']);
  });

  test('renaming the output file changes the saved file name', async ({ page }) => {
    await page.getByTestId('tb-filename').click();
    const input = page.getByTestId('tb-filename-input');
    await input.fill('renamed');
    await input.press('Enter');
    await expect(page.getByTestId('tb-filename')).toContainText('renamed.pdf');
    const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('ControlOrMeta+s')]);
    expect(download.suggestedFilename()).toBe('renamed.pdf');
  });

  test('saves only the selected pages', async ({ page }) => {
    await page.getByTestId('tb-view-grid').click();
    await page.getByTestId('page-thumb').nth(3).click();
    await page.getByTestId('page-thumb').nth(1).click({ modifiers: ['ControlOrMeta'] });
    const bytes = await saveAndDownload(page, async () => {
      await page.getByTestId('tb-menu').click();
      await page.getByTestId('tb-save-selected').click();
    });
    const texts = await pageTexts(bytes);
    expect(texts).toEqual(['P2', 'P4']);
  });
});
