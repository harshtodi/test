// Launches the packaged (electron-builder --dir) app, opens a generated PDF
// from the command line and checks that the page actually renders.
//
//   npm run package:dir && xvfb-run -a node scripts/smoke-packaged.mjs
import { _electron as electron } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const candidates = {
  linux: path.join(root, 'release', 'linux-unpacked', 'pdf-editor'),
  darwin: path.join(root, 'release', 'mac', 'PDF Editor.app', 'Contents', 'MacOS', 'PDF Editor'),
  win32: path.join(root, 'release', 'win-unpacked', 'PDF Editor.exe'),
};
const executablePath = process.env.PDF_EDITOR_BINARY ?? candidates[process.platform];
if (!executablePath || !existsSync(executablePath)) {
  console.error(`packaged binary not found at ${executablePath}; run npm run package:dir first`);
  process.exit(2);
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'pdf-editor-smoke-'));
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
for (let i = 1; i <= 3; i++) {
  const page = doc.addPage([612, 792]);
  page.drawText(`Packaged smoke page ${i}`, { x: 60, y: 700, size: 30, font });
}
const pdfPath = path.join(tmp, 'smoke.pdf');
writeFileSync(pdfPath, await doc.save());

const args = [pdfPath];
if (typeof process.getuid === 'function' && process.getuid() === 0) args.push('--no-sandbox');
const app = await electron.launch({
  executablePath,
  args,
  env: { ...process.env, PDF_EDITOR_USER_DATA_DIR: path.join(tmp, 'userData'), VITE_DEV_SERVER_URL: '' },
  timeout: 60_000,
});
try {
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  const url = win.url();
  if (!url.startsWith('app://')) throw new Error(`unexpected URL ${url}`);
  await win.getByTestId('page-thumb').nth(2).waitFor({ timeout: 30_000 });
  await win.locator('[data-testid="page-canvas"][data-render-status="done"]').waitFor({ timeout: 30_000 });
  const thumbs = await win.getByTestId('page-thumb').count();
  const title = await win.title();
  // eslint-disable-next-line no-undef -- evaluated inside the renderer
  const versions = await win.evaluate(() => window.pdfEditor?.versions);
  console.log(`OK: ${executablePath}`);
  console.log(`   url=${url} title="${title}" thumbnails=${thumbs} electron=${versions?.electron} chrome=${versions?.chrome}`);
  if (thumbs !== 3) throw new Error(`expected 3 thumbnails, got ${thumbs}`);
} finally {
  // The document is dirty after an import, so a normal quit would show the
  // "unsaved changes" prompt (correct for users, fatal for automation): exit hard.
  const killer = setTimeout(() => app.process().kill('SIGKILL'), 5_000);
  try {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0));
  } catch {
    /* the process is gone */
  }
  clearTimeout(killer);
}
