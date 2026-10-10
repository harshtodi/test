// Rasterizes build/icon.svg to build/icon.png (1024x1024, transparent) with
// Playwright's bundled Chromium. electron-builder derives .ico/.icns from the PNG.
//
//   node scripts/make-icon.mjs            # writes build/icon.png
//   node scripts/make-icon.mjs --size 512 # other size
// `@playwright/test` (a declared devDependency) re-exports the browser launchers.
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sizeArg = process.argv.indexOf('--size');
const size = sizeArg >= 0 ? Number(process.argv[sizeArg + 1]) || 1024 : 1024;
const svgPath = path.join(root, 'build', 'icon.svg');
const pngPath = path.join(root, 'build', 'icon.png');

const svg = await readFile(svgPath, 'utf8');
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:transparent;width:${size}px;height:${size}px;overflow:hidden}
  img{display:block;width:${size}px;height:${size}px}
</style></head><body><img src="${dataUrl}" alt=""></body></html>`;

// Chromium refuses to run its sandbox as root (CI containers); nothing untrusted is loaded here.
const args = typeof process.getuid === 'function' && process.getuid() === 0 ? ['--no-sandbox'] : [];
const browser = await chromium.launch({ args });
try {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  // eslint-disable-next-line no-undef -- runs inside the page
  await page.evaluate(() => document.querySelector('img').decode());
  const png = await page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await writeFile(pngPath, png);
  console.log(`wrote ${path.relative(root, pngPath)} (${size}x${size}, ${png.length} bytes)`);
} finally {
  await browser.close();
}
