// Copies pdf.js's standard-font and CMap data into public/pdfjs so the renderer
// can display PDFs that rely on non-embedded fonts or CJK encodings. Runs on
// postinstall and before dev/build; the output directory is git-ignored.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules', 'pdfjs-dist');
const dest = path.join(root, 'public', 'pdfjs');

if (!existsSync(src)) {
  console.error('pdfjs-dist is not installed; run npm install first');
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ['standard_fonts', 'cmaps']) {
  cpSync(path.join(src, dir), path.join(dest, dir), { recursive: true });
}
console.log(`copied pdf.js standard_fonts and cmaps to ${path.relative(root, dest)}`);
