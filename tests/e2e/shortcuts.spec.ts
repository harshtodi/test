import { test, expect, type Download, type Page } from '@playwright/test';
import { openApp, uploadPdf, expectPageCount } from './helpers';

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

/** Draw a rectangle (20%–40% of the page) on the active page and select it. */
async function drawAndSelectRect(page: Page) {
  const box = (await page.getByTestId('annotation-layer').boundingBox())!;
  const p = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
  await page.getByTestId('tool-rect').click();
  await drag(page, p(0.2, 0.2), p(0.4, 0.4));
  await expect(page.getByTestId('annotation')).toHaveCount(1);
  await page.getByTestId('tool-select').click();
  await selectRect(page);
}

/** Click inside the rectangle drawn by drawAndSelectRect (hit-testing is done by the layer, not the DOM). */
async function selectRect(page: Page) {
  const box = (await page.getByTestId('annotation-layer').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await expect(page.getByTestId('selection-box')).toBeVisible();
}

const checked = (page: Page, testId: string) => page.getByTestId(testId).getAttribute('aria-checked');

test.use({ viewport: { width: 1280, height: 1600 } });

test.describe('keyboard shortcuts', () => {
  test('tool keys mirror the toolbar: inert without a document and in the Pages view', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await page.keyboard.press('g');
    await page.keyboard.press('p');
    await expect(page.getByTestId('signature-dialog')).toHaveCount(0);
    expect(await checked(page, 'tool-pen')).toBe('false');

    await uploadPdf(page, 'doc.pdf', [{ label: 'A' }]);
    await expectPageCount(page, 1);
    expect(await checked(page, 'tool-select')).toBe('true');

    await page.getByTestId('tb-view-grid').click();
    await page.keyboard.press('t');
    expect(await checked(page, 'tool-text')).toBe('false');

    await page.getByTestId('tb-view-editor').click();
    await page.keyboard.press('t');
    await expect(page.getByTestId('tool-text')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('g');
    await expect(page.getByTestId('signature-dialog')).toBeVisible();
  });

  test('Delete in the Pages view removes the selected pages, not a hidden annotation', async ({ page }) => {
    await openApp(page);
    await uploadPdf(page, 'doc.pdf', [{ label: 'A' }, { label: 'B' }]);
    await expectPageCount(page, 2);
    await drawAndSelectRect(page);

    await page.getByTestId('tb-view-grid').click();
    await page.getByTestId('grid-select-all').click();
    await expect(page.getByTestId('selected-count')).toHaveText('2 selected');
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('empty-state')).toBeVisible();

    // one undo brings the pages back with the annotation untouched
    await page.getByTestId('tb-undo').click();
    await expectPageCount(page, 2);
    await page.getByTestId('tb-view-editor').click();
    await expect(page.getByTestId('annotation')).toHaveCount(1);
  });

  test('Ctrl+Z undoes a restyle while the options <select> still has focus', async ({ page }) => {
    await openApp(page);
    await uploadPdf(page, 'doc.pdf', [{ label: 'A' }]);
    await expectPageCount(page, 1);
    await drawAndSelectRect(page);
    const width = page.getByTestId('opt-stroke-width');
    await width.selectOption('5');
    await expect(page.getByTestId('annotation')).toHaveAttribute('stroke-width', '5');
    await width.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByTestId('annotation')).toHaveAttribute('stroke-width', '2');
    // Delete works from there too (a <select> has nothing to delete natively)
    await selectRect(page);
    await width.focus();
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('annotation')).toHaveCount(0);
  });

  test('a second Ctrl+S while a save is running does not produce a second file', async ({ page }) => {
    await openApp(page);
    await uploadPdf(page, 'doc.pdf', [{ label: 'A' }, { label: 'B' }, { label: 'C' }]);
    await expectPageCount(page, 3);
    const downloads: Download[] = [];
    page.on('download', (d) => downloads.push(d));
    await Promise.all([
      page.waitForEvent('download'),
      // two presses in the same task: the second lands while the first export runs
      page.evaluate(() => {
        for (let i = 0; i < 2; i++) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
        }
      }),
    ]);
    await expect(page.getByTestId('notice')).toContainText(/^Saved /);
    await page.waitForTimeout(500);
    expect(downloads).toHaveLength(1);
    await expect(page.getByTestId('tb-save')).toHaveAttribute('data-dirty', 'false');
  });
});
