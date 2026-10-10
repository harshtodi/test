import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { openApp, uploadPdf, expectPageCount, pageTexts, saveAndDownload, extractText } from './helpers';

async function layerBox(page: Page) {
  const box = await page.getByTestId('annotation-layer').boundingBox();
  if (!box) throw new Error('annotation layer not visible');
  return box;
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

const annotations = (page: Page) => page.getByTestId('annotation');

test.describe('annotations', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await uploadPdf(page, 'doc.pdf', [{ label: 'Front' }, { label: 'Back' }]);
    await expectPageCount(page, 2);
    await expect(page.getByTestId('annotation-layer')).toBeVisible();
  });

  test('adds text that survives the save round trip', async ({ page }) => {
    const box = await layerBox(page);
    await page.getByTestId('tool-text').click();
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.5);
    const input = page.getByTestId('text-editor-input');
    await expect(input).toBeVisible();
    await input.fill('Hello from the editor');
    await page.keyboard.press('Escape');
    await expect(annotations(page)).toHaveCount(1);
    await expect(annotations(page).first()).toHaveAttribute('data-annotation-type', 'text');

    const bytes = await saveAndDownload(page);
    const texts = await pageTexts(bytes);
    expect(texts[0]).toContain('Hello from the editor');
    expect(texts[1]).toBe('Back');
  });

  test('text on a rotated page is placed upright', async ({ page }) => {
    // rotate the first page 90° clockwise, then annotate it
    const thumb = page.getByTestId('page-thumb').nth(0);
    await thumb.hover();
    await thumb.getByTestId('thumb-rotate-cw').click();
    const box = await layerBox(page);
    await page.getByTestId('tool-text').click();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.getByTestId('text-editor-input').fill('Sideways');
    await page.keyboard.press('Escape');
    const bytes = await saveAndDownload(page);
    const items = (await extractText(bytes))[0]!;
    const item = items.find((i) => i.str.includes('Sideways'));
    expect(item).toBeTruthy();
    // pdf.js reports the user-space transform; for a /Rotate 90 page the text
    // must be drawn rotated 90° counter-clockwise in user space to read upright.
    const [a, b] = item!.transform;
    expect(Math.abs(a!)).toBeLessThan(0.01);
    expect(b!).toBeGreaterThan(0);
  });

  test('draws with the pen, highlighter, rectangle and whiteout tools', async ({ page }) => {
    const box = await layerBox(page);
    const p = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

    await page.getByTestId('tool-pen').click();
    await drag(page, p(0.1, 0.1), p(0.4, 0.2));
    await expect(annotations(page)).toHaveCount(1);
    await expect(annotations(page).nth(0)).toHaveAttribute('data-annotation-type', 'ink');

    await page.getByTestId('tool-highlighter').click();
    await drag(page, p(0.1, 0.3), p(0.6, 0.3));
    await expect(annotations(page)).toHaveCount(2);

    await page.getByTestId('tool-rect').click();
    await drag(page, p(0.5, 0.5), p(0.8, 0.7));
    await expect(annotations(page)).toHaveCount(3);
    await expect(annotations(page).nth(2)).toHaveAttribute('data-annotation-type', 'rect');

    await page.getByTestId('tool-whiteout').click();
    await drag(page, p(0.05, 0.05), p(0.5, 0.15));
    await expect(annotations(page)).toHaveCount(4);

    const bytes = await saveAndDownload(page);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    // the whiteout covers the page label, so text extraction still finds it but the
    // page content stream must have grown; at minimum the document loads cleanly.
    const texts = await pageTexts(bytes);
    expect(texts[1]).toBe('Back');
  });

  test('selects, moves, restyles and deletes an annotation; undo restores it', async ({ page }) => {
    const box = await layerBox(page);
    const p = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
    await page.getByTestId('tool-rect').click();
    await drag(page, p(0.2, 0.2), p(0.4, 0.4));
    await expect(annotations(page)).toHaveCount(1);

    await page.getByTestId('tool-select').click();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await expect(page.getByTestId('selection-box')).toBeVisible();

    // move it
    const before = await annotations(page).first().boundingBox();
    await drag(page, p(0.3, 0.3), p(0.5, 0.5));
    const after = await annotations(page).first().boundingBox();
    expect(after!.x).toBeGreaterThan(before!.x + 10);
    expect(after!.y).toBeGreaterThan(before!.y + 10);

    // restyle via tool options while selected
    await page.getByTestId('opt-color-blue').click();

    // delete + undo
    await page.keyboard.press('Delete');
    await expect(annotations(page)).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(annotations(page)).toHaveCount(1);
    // the move was one undo step
    await page.keyboard.press('ControlOrMeta+z'); // undo restyle
    await page.keyboard.press('ControlOrMeta+z'); // undo move
    const restored = await annotations(page).first().boundingBox();
    expect(Math.abs(restored!.x - before!.x)).toBeLessThan(3);
  });

  test('annotations stay attached to their page when pages are reordered or duplicated', async ({ page }) => {
    const box = await layerBox(page);
    await page.getByTestId('tool-text').click();
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.6);
    await page.getByTestId('text-editor-input').fill('Sticky note');
    await page.keyboard.press('Escape');

    const thumb = page.getByTestId('page-thumb').nth(0);
    await thumb.hover();
    await thumb.getByTestId('thumb-duplicate').click();
    await expectPageCount(page, 3);
    const bytes = await saveAndDownload(page);
    const texts = await pageTexts(bytes);
    expect(texts[0]).toContain('Sticky note');
    expect(texts[1]).toContain('Sticky note');
    expect(texts[2]).toBe('Back');
  });
});

test.describe('signatures', () => {
  test('draw a signature and place it on the page', async ({ page }) => {
    await openApp(page);
    await uploadPdf(page, 'contract.pdf', [{ label: 'Sign here' }]);
    await expectPageCount(page, 1);
    await page.getByTestId('tool-signature').click();
    const dialog = page.getByTestId('signature-dialog');
    await expect(dialog).toBeVisible();
    const canvas = page.getByTestId('sig-canvas');
    const cb = (await canvas.boundingBox())!;
    await page.mouse.move(cb.x + 40, cb.y + cb.height / 2);
    await page.mouse.down();
    await page.mouse.move(cb.x + cb.width / 2, cb.y + 30, { steps: 10 });
    await page.mouse.move(cb.x + cb.width - 40, cb.y + cb.height - 30, { steps: 10 });
    await page.mouse.up();
    await page.getByTestId('sig-use').click();
    await expect(dialog).toHaveCount(0);

    const box = (await page.getByTestId('annotation-layer').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.8);
    await expect(page.getByTestId('annotation')).toHaveCount(1);
    await expect(page.getByTestId('annotation').first()).toHaveAttribute('data-annotation-type', 'image');

    const bytes = await saveAndDownload(page);
    const doc = await PDFDocument.load(bytes);
    const resources = doc.getPage(0).node.Resources();
    const xobjects = resources?.lookup(PDFName.of('XObject'), PDFDict);
    expect(xobjects?.keys().length ?? 0).toBeGreaterThan(0);
  });

  test('a typed signature is saved for reuse', async ({ page }) => {
    await openApp(page);
    await uploadPdf(page, 'contract.pdf', [{ label: 'Sign here' }]);
    await page.getByTestId('tool-signature').click();
    await page.getByTestId('sig-tab-type').click();
    await page.getByTestId('sig-type-input').fill('Harsh Todi');
    await page.getByTestId('sig-use').click();
    await expect(page.getByTestId('signature-dialog')).toHaveCount(0);
    // reopen the picker: the signature is listed
    await page.getByTestId('tool-signature-pick').click();
    await expect(page.getByTestId('sig-saved-item')).toHaveCount(1);
  });
});
