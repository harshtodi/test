# M1 core engine — test ids

The core engine (`src/core/import.ts`, `src/core/export.ts`, `src/core/pdf-utils.ts`) has no UI and therefore no `data-testid` attributes.

For e2e authors verifying exports, the Node helpers in `tests/helpers/` are reusable:

- `tests/helpers/make-pdf.ts` — `makePdf`, `makeLabeledPdf`, `makeEncryptedPdf`, `makeEmptyPdf`, `TINY_PNG`, `TINY_JPEG`, `FAKE_WEBP`, `toDataUrl`.
- `tests/helpers/make-png.ts` — `makePng(width, height, rgba)` builds a PNG of any size in memory.
- `tests/helpers/pdfjs.ts` — load an output PDF with pdf.js in Node: `getPageTexts`, `findText` (text item + transform), `getPageView`.
- `tests/helpers/pdf-inspect.ts` — load with pdf-lib: `pageContent` (decoded content streams), `pageResources`, `countImageXObjects`, `graphicsStateBalance`.
