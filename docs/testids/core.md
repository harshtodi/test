# M1 core engine — test ids

The core engine (`src/core/import.ts`, `src/core/export.ts`, `src/core/pdf-utils.ts`) has no UI and therefore no `data-testid` attributes.

For e2e authors verifying exports, the Node helpers in `tests/helpers/` are reusable:

- `tests/helpers/make-pdf.ts` — `makePdf`, `makeLabeledPdf`, `makeStructuredPdf` (inherited MediaBox/CropBox/Rotate/Resources, shared `/Contents` arrays), `makeEncryptedPdf`, `makeEmptyPdf`, `TINY_PNG`, `TINY_JPEG`, `FAKE_WEBP`, `toDataUrl`.
- `tests/helpers/make-png.ts` — `makePng(width, height, rgba)` builds a PNG of any size in memory.
- `tests/helpers/pdfjs.ts` — load an output PDF with pdf.js in Node: `getPageTexts`, `findText` (text item + transform), `getPageView`.
- `tests/helpers/pdf-inspect.ts` — load with pdf-lib: `pageContent` (decoded content streams), `pageResources`, `countImageXObjects`, `graphicsStateBalance`.

## Updates after M7 (hardening)

New exported helpers:

- `src/core/import.ts`: `exifRotation(orientation)`, `jpegExifOrientation(bytes)` (EXIF tag → page rotation).
- `src/core/pdf-utils.ts`: `repairPageTree(doc)` (types untyped page-tree nodes so pdf-lib and pdf.js agree), `encryptedMessage(name, doc)`.
- `src/core/text-metrics.ts`: `isWinAnsiChar(ch)`, `sanitizeText(text, canEncode, stats?)`, `exportPreviewText(text)`.
- `src/core/export.ts`: `ExportOptions.warnings` collects non-fatal export problems; the original page content is wrapped in a Form XObject (`/PEfmN`) before the annotation layer is appended.
- `src/core/render.ts`: `releasePage(source, sourceIndex)` frees pdf.js's decoded page data.
- `src/app/text-raster.ts` (browser only): `needsRasterFallback(text)`, `rasterizeTextAnnotation(a)`, `prepareTextForExport(pages)`.

New test helpers (`tests/helpers`): `make-pdf.ts` → `makeUntypedPageTreePdf`, `makePdfWithInfo`, `jpegWithExif`; `pdf-inspect.ts` → `pageContentInlined` (inlines Form XObjects so content assertions see the page's drawing operators).
