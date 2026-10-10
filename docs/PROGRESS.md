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
- [x] **M7 — Review & hardening**: six area bug-hunters + adversarial verification produced 47 confirmed findings; all fixed except keyboard access to annotations (recorded below). Results: `npm run check` green (230 unit tests), web e2e 35/35, Electron smoke 11/11 under xvfb. Decisions recorded in the log below.
- [x] **M8 — Packaging verification**: `electron-builder --dir --linux` builds (12 MB asar, node_modules excluded, icon shipped as extra resource); `scripts/smoke-packaged.mjs` launches the packaged binary under xvfb, opens a PDF from the command line and confirms rendering (`npm run smoke:packaged`). Windows/macOS installers are produced by `.github/workflows/release.yml` on a `v*` tag — **not yet exercised in GitHub Actions** (needs the repository on GitHub with Actions enabled).
- [x] **M9 — Docs**: README (get it / use it / shortcuts / development / resuming work), docs/INSTALL.md (per-OS install, Gatekeeper/SmartScreen notes, build from source, publishing a release), docs/ARCHITECTURE.md, docs/testids/*.md.

## Next steps (not started)

1. Push this history to its own repository (`pdf-editor`) and set `main` as the default branch; enable *Settings → Pages → Source: GitHub Actions* for the web app.
2. Push a `v0.1.0` tag to produce the first Windows/macOS/Linux installers via `release.yml`; test one install per OS and fix anything platform-specific (macOS/Windows code paths are untested so far).
3. Optional improvements: embed a Unicode fallback font (fontkit) so non-Latin text stays selectable; keyboard access to annotations; code signing / notarisation when certificates are available.

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
- **An import into an empty document with no history is not undoable**; after deleting every page the import is recorded so undo can restore the old pages, and the new file names the output. `clearDocument` resets tool/zoom/view.
- **Unicode text**: the exporter embeds only the standard 14 fonts (WinAnsi). Before saving, `src/app/text-raster.ts` rasterises any text annotation containing other characters (CJK, Arabic, Cyrillic, emoji…) with the browser's fonts at ~288 dpi and exports it as an image, so the saved page matches the screen; Latin text stays real PDF text. `exportPdf` reports residual problems through `ExportOptions.warnings`, which the save toast shows. A fontkit-embedded fallback font would make such text selectable; not done.
- **Original page content is isolated in a Form XObject** on export (`q /PEfmN Do Q`), so unbalanced `q`/`cm` operators in a source page cannot shift the annotation layer (one unmatched `q` after a `cm` was enough to break the old approach).
- **Lenient page trees**: `repairPageTree` (pdf-utils) gives `/Type` to untyped page-tree nodes after load so pdf-lib and pdf.js enumerate the same pages (otherwise the editor could show one page and export another).
- **JPEG EXIF orientation** is honoured: the app re-encodes oriented JPEGs upright before import; `importFile` also reads the tag as a fallback.
- **Busy state**: imports are serialised and saves are guarded (`store.busy`); the toolbar disables Save while busy and `Notice` shows a busy indicator.
- **Memory**: `releasePage` frees pdf.js's decoded page data when the editor leaves a page; thumbnails release after rendering.
- **Multi-selection** in the sidebar is honoured by the toolbar page actions and the Delete key in either view.
- **Electron**: `app.enableSandbox()` is deliberately not used (it forces `--enable-sandbox`, which overrides `--no-sandbox` and kills child processes when running as root in CI); per-window `sandbox: true` instead. `PDF_EDITOR_USER_DATA_DIR` env overrides the prefs dir for tests. Unsigned macOS builds need right-click → Open the first time.
- **Web deployment**: `.github/workflows/deploy-pages.yml` publishes the renderer to GitHub Pages from `main` (enable Pages → Source: GitHub Actions once). `public/manifest.webmanifest` makes it installable from the browser.

## Known gaps / follow-ups

- Export: non-Latin text is rasterised (not selectable/searchable); embedding a Unicode fallback font via `@pdf-lib/fontkit` would fix that. Duplicated pages embed shared fonts/images once per copy; ink is exported as polylines (no smoothing); imported photos are not downsampled.
- Export re-parses every source on each save (200 pages ≈ 0.4 s); cache pdf-lib documents per source if large files feel slow.
- AcroForm fields: widget appearances are copied but the output has no `/AcroForm`, so forms are flattened-looking, not interactive.
- Editor: annotations cannot be reached, selected or nudged from the keyboard (the overlay is not focusable) — deliberate later milestone. Pen/highlighter points are not clamped to the page; devicePixelRatio changes do not trigger a re-render until the next zoom/page change; `render.ts` never times out if the pdf.js worker fails to load.
- Signature dialog: changing colour/width recolours the whole drawing; saved signatures capped at 8 (oldest evicted when localStorage is full; a signature that does not fit alone is not remembered).
- Electron: only Linux (xvfb) exercised locally; macOS/Windows code paths untested until the release workflow runs. GTK may not fire accelerators of hidden menu items (zoom twins) on Linux.
- Web app: saving uses a download when the File System Access API is unavailable; the reported name is then the suggested one.
