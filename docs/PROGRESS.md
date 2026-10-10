# Progress ledger

This file is the hand-off point between work sessions. **Read it first.** Every
milestone below is committed and pushed as soon as it is done, so a fresh
session can pick up exactly where the last one stopped without redoing work.

How to resume:

1. `git pull`, then `npm install`.
2. Run `npm run check` (typecheck + lint + unit tests). Fix anything red first.
3. Find the first milestone that is not `[x]` and continue from its notes.
4. When a milestone is done: tick it, add notes/decisions, commit and push.

Status legend: `[x]` done · `[~]` in progress (notes say what is left) · `[ ]` not started

## Milestones

- [x] **M0 — Scaffold & contracts** (Vite + React + TypeScript renderer, Electron shell skeleton, pdf-lib + pdf.js, Zustand store, data model in `src/core/types.ts`, platform abstraction, build scripts, test configs, this ledger).
- [x] **M1 — Core PDF engine**: `src/core/import.ts` (PDF + image import, blank page source) and `src/core/export.ts` (merge/reorder/rotate/duplicate, flatten annotations with display→user transform). Unit tests in `tests/unit/` (import, export incl. text position/orientation on 0/90/180/270 pages, geometry).
- [x] **M2 — Rendering & page grid**: `src/core/render.ts` (pdf.js document cache, page/thumbnail rendering), `src/components/PageGrid/` (sortable thumbnails via dnd-kit incl. multi-page block moves, multi-select, rotate/delete/duplicate/insert blank, keyboard navigation, lazy thumbnails, list + grid variants).
- [x] **M3 — Page editor**: `src/components/Editor/` (pdf.js canvas + SVG overlay, tools: select/move/resize/delete, text with inline editor, pen, highlighter, rectangle, highlight box, whiteout, signature placement, fit-to-width zoom + ctrl-wheel). Pure logic in `tools/*.ts` with unit tests.
- [x] **M4 — Toolbar & signatures**: `src/components/Toolbar/` (file menu, undo/redo, view toggle, page navigation, page ops, tools, context-sensitive options that also restyle the selected annotation, zoom) and `src/components/Signature/` (draw / type / upload, trimmed transparent PNG, saved signatures in localStorage).
- [x] **M5 — Desktop shell**: `electron/` (secure window, `app://` protocol with traversal protection, native open/save dialogs with validated IPC, menu, single instance + file association / CLI open, unsaved-changes prompt, window state), electron-builder config, app icon (`build/icon.svg` → `scripts/make-icon.mjs`), GitHub Actions `ci.yml` + `release.yml`, `docs/INSTALL.md`. Electron smoke test in `tests/e2e/electron/`.
- [x] **M6 — Integration & web e2e**: everything wired in `src/App.tsx`; integration fixes applied (pdf.js legacy build, annotation remap on page rotation, Ctrl+O / zoom shortcuts, native undo in text fields from the macOS menu, scrollbar gutter, Windows portable artifact name, icon as extra resource, pdf.js standard fonts + CMaps bundled, vendor chunks split). Playwright specs in `tests/e2e/` (open, pages, annotate, signatures): 19/19 green; Electron smoke: 10/10 green under xvfb; `electron-builder --dir --linux` succeeds.
- [~] **M7 — Review & hardening**: workflow running (six area bug-hunters → adversarial verification → one fixer per file group). **Left: review its report, re-run `npm run check`, web e2e and Electron smoke, record remaining gaps below.**
- [ ] **M8 — Packaging verification**: `npm run package:dir` on Linux, Electron smoke test (`tests/e2e/electron/`) under xvfb, confirm installers build in CI for Windows/macOS/Linux.
- [ ] **M9 — Docs**: README (install per OS, usage, keyboard shortcuts, development), ARCHITECTURE notes final.

## Decisions log

- **Stack**: Electron 39 + Vite 7 + React 19 + TypeScript 5.9. pdf.js (`pdfjs-dist` 5.x) renders; `pdf-lib` edits/writes. Zustand holds state with an undo/redo snapshot history. `@dnd-kit` for page reordering.
- **Annotation coordinates** live in *display space* (points, origin bottom-left of the rotated page). The exporter applies one `cm` matrix per page (`displayToUserMatrix`) so rotated pages need no special-casing in tools. See the header comment in `src/core/types.ts`.
- **Images and blank pages are converted to one-page PDFs on import**, so every page in the document has a PDF source. Keeps rendering and export uniform.
- **"Edit pages" scope**: page-level operations (reorder, rotate, delete, duplicate, insert blank) plus an annotation layer (text, ink, highlighter, shapes, whiteout to cover existing content, signatures). Editing a PDF's original text runs is out of scope.
- **Renderer is a plain web app**: it also runs in a browser (`npm run dev:web`), which is how the Playwright suite exercises the UI. Electron-only features go through `src/platform`.
- **Repository**: the project was built in `harshtodi/test` on branch `claude/vigilant-wozniak-hh1v75` because the session could not create repositories. Move it with `git push <new-remote> HEAD:main` once the destination repo exists.
- **pdf.js legacy build**: `pdfjs-dist` 5.7's modern build calls `Map.prototype.getOrInsertComputed`, which Chromium 141/142 (Playwright, Electron 39) lack, so nothing rendered. `src/core/render.ts` imports `pdfjs-dist/legacy/build/*` (bundles the polyfills). Keep it that way until the engines catch up.
- **Import** keeps the original PDF bytes; the visible box is CropBox ∩ MediaBox (matches pdf.js `page.view`); a `/Rotate` that is not a multiple of 90 is treated as 0 (pdf.js behaviour); images become a Letter page oriented by aspect ratio, fit + centered.
- **Export** copies duplicated source pages in separate `copyPages` rounds (same page leaf cannot be added twice); the annotation layer is its own content stream `q <cm> … Q`; one ExtGState per page per (opacity, blend mode); standard fonts embedded once per document; images cached by data URL per export; text sanitized to WinAnsi (`?` for unsupported glyphs).
- **Rotating a page remaps its annotations** (`src/core/annotation-transform.ts`) so they stay on the content they were drawn over.
- **First import is not undoable** (no snapshot when the document was empty); `clearDocument` resets tool/zoom/view.
- **Electron**: `app.enableSandbox()` is deliberately not used (it forces `--enable-sandbox`, which overrides `--no-sandbox` and kills child processes when running as root in CI); per-window `sandbox: true` instead. `PDF_EDITOR_USER_DATA_DIR` env overrides the prefs dir for tests. Unsigned macOS builds need right-click → Open the first time.
- **Web deployment**: `.github/workflows/deploy-pages.yml` publishes the renderer to GitHub Pages from `main` (enable Pages → Source: GitHub Actions once). `public/manifest.webmanifest` makes it installable from the browser.

## Known gaps / follow-ups

- Export: a malformed source page that leaves two or more unmatched `q` operators could shift the annotation CTM (pdf-lib's wrapper neutralises one). Fixing it needs content-stream tokenizing.
- Export: duplicated pages embed shared fonts/images once per copy (bigger files for many duplicates); ink is exported as polylines (no smoothing); imported photos are not downsampled.
- Export re-parses every source on each save (200 pages ≈ 0.4 s); cache pdf-lib documents per source if large files feel slow.
- AcroForm fields: widget appearances are copied but the output has no `/AcroForm`, so forms are flattened-looking, not interactive.
- Editor: pen/highlighter points are not clamped to the page; devicePixelRatio changes do not trigger a re-render until the next zoom/page change; `render.ts` never times out if the pdf.js worker fails to load.
- Signature dialog: changing colour/width recolours the whole drawing; saved signatures capped at 8 (oldest evicted when localStorage is full).
- Electron: only Linux (xvfb) exercised locally; macOS/Windows code paths untested until the release workflow runs. GTK may not fire accelerators of hidden menu items (zoom twins) on Linux.
- Toolbar helpers (`src/components/Toolbar/helpers.ts`) have no unit tests yet.
