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
- [ ] **M1 — Core PDF engine**: `src/core/import.ts` (PDF + image import, blank page source) and `src/core/export.ts` (merge/reorder/rotate/duplicate, flatten annotations with display→user transform). Unit tests in `tests/unit/`.
- [ ] **M2 — Rendering & page grid**: `src/core/render.ts` (pdf.js document cache, page/thumbnail rendering), `src/components/PageGrid/` (sortable thumbnails via dnd-kit, multi-select, rotate/delete/duplicate/insert blank, list + grid variants).
- [ ] **M3 — Page editor**: `src/components/Editor/` (pdf.js canvas + SVG overlay, tools: select/move/resize/delete, text, pen, highlighter, rectangle, highlight box, whiteout, signature placement, zoom).
- [ ] **M4 — Toolbar & signatures**: `src/components/Toolbar/` (tools, colors, sizes, undo/redo, zoom, view toggle, save) and `src/components/Signature/` (draw or type a signature, keep saved signatures in localStorage).
- [ ] **M5 — Desktop shell**: `electron/main.ts` + `electron/preload.ts` (secure window, `app://` protocol for the production bundle, native open/save dialogs, menu, file association / CLI open, unsaved-changes prompt), electron-builder config, app icon, GitHub Actions CI + release workflows.
- [ ] **M6 — Integration & web e2e**: wire everything in `src/App.tsx`, Playwright tests in `tests/e2e/` covering drop/open, reorder, rotate, delete, text, drawing, signature, save round-trip (verify output with pdf-lib/pdf.js).
- [ ] **M7 — Review & hardening**: bug-hunt pass over core + UI, fixes, edge cases (encrypted PDFs, rotated pages, huge pages, many files).
- [ ] **M8 — Packaging verification**: `npm run package:dir` on Linux, Electron smoke test (`tests/e2e/electron/`) under xvfb, confirm installers build in CI for Windows/macOS/Linux.
- [ ] **M9 — Docs**: README (install per OS, usage, keyboard shortcuts, development), ARCHITECTURE notes final.

## Decisions log

- **Stack**: Electron 39 + Vite 7 + React 19 + TypeScript 5.9. pdf.js (`pdfjs-dist` 5.x) renders; `pdf-lib` edits/writes. Zustand holds state with an undo/redo snapshot history. `@dnd-kit` for page reordering.
- **Annotation coordinates** live in *display space* (points, origin bottom-left of the rotated page). The exporter applies one `cm` matrix per page (`displayToUserMatrix`) so rotated pages need no special-casing in tools. See the header comment in `src/core/types.ts`.
- **Images and blank pages are converted to one-page PDFs on import**, so every page in the document has a PDF source. Keeps rendering and export uniform.
- **"Edit pages" scope**: page-level operations (reorder, rotate, delete, duplicate, insert blank) plus an annotation layer (text, ink, highlighter, shapes, whiteout to cover existing content, signatures). Editing a PDF's original text runs is out of scope.
- **Renderer is a plain web app**: it also runs in a browser (`npm run dev:web`), which is how the Playwright suite exercises the UI. Electron-only features go through `src/platform`.
- **Repository**: the project was built in `harshtodi/test` on branch `claude/vigilant-wozniak-hh1v75` because the session could not create repositories. Move it with `git push <new-remote> HEAD:main` once the destination repo exists.

## Known gaps / follow-ups

- (none yet)
