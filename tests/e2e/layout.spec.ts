import { test, expect } from '@playwright/test';
import { openApp, uploadPdf, expectPageCount } from './helpers';

// The base stylesheet (.btn) must load before the component stylesheets so the
// toolbar's size overrides win; otherwise the icon-only controls shrink their
// icons to slivers. Checked in both colour schemes.
test.describe('toolbar layout', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`narrow windows keep the icon-only controls at their designed sizes (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width: 1000, height: 800 });
      await openApp(page);
      await uploadPdf(page, 'doc.pdf', [{ label: 'One' }]);
      await expectPageCount(page, 1);

      const seg = page.getByTestId('tb-view-grid');
      await expect(seg).toHaveCSS('padding-left', '0px');
      const segBox = (await seg.boundingBox())!;
      expect(segBox.width).toBeCloseTo(34, 0);
      const icon = (await seg.locator('svg').boundingBox())!;
      expect(icon.width).toBeCloseTo(18, 0);
      expect(icon.height).toBeCloseTo(18, 0);

      const caret = (await page.getByTestId('tool-signature-pick').boundingBox())!;
      expect(caret.width).toBeCloseTo(20, 0);
      await expect(page.getByTestId('tb-zoom-level')).toHaveCSS('padding-left', '8px');
      await expect(page.getByTestId('tb-zoom-level')).toHaveCSS('padding-top', '0px');
    });
  }

  test('at desktop width the labelled view toggle and the signature caret keep their sizes', async ({ page }) => {
    await openApp(page);
    await uploadPdf(page, 'doc.pdf', [{ label: 'One' }]);
    await expectPageCount(page, 1);
    const seg = page.getByTestId('tb-view-grid');
    await expect(seg).toHaveCSS('padding-left', '10px');
    await expect(seg).toHaveCSS('padding-top', '0px');
    await expect(seg.locator('.tb-label')).toBeVisible();
    const caret = (await page.getByTestId('tool-signature-pick').boundingBox())!;
    expect(caret.width).toBeCloseTo(20, 0);
  });
});
