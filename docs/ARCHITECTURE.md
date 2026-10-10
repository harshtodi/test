# Architecture

```
electron/            Main process + preload (Node side). Never imported by the renderer.
src/
  core/              Pure TypeScript, no DOM: data model, geometry, import, export.
  core/render.ts     pdf.js rendering (browser only).
  state/store.ts     Zustand store: sources, ordered pages, annotations, undo/redo, UI state.
  platform/          Host abstraction (Electron bridge vs browser fallbacks).
  app/               Cross-cutting actions (open/save) and keyboard shortcuts.
  components/        React UI: Toolbar, PageGrid (dnd-kit), Editor (canvas + SVG overlay), Signature.
tests/unit           Vitest (Node) — core engine.
tests/e2e            Playwright (Chromium, web mode) — full UI flows + output verification.
tests/e2e/electron   Playwright Electron smoke tests.
scripts/             dev launcher, esbuild bundling of electron/.
```

## Data flow
1. Files arrive (drop, dialog, menu, CLI) → `openFiles()` → `importFile()` turns PDFs/images into `SourceDoc`s (immutable bytes + per-page size/rotation).
2. `store.addSource()` appends `PageRef`s. All editing (reorder/rotate/delete/annotate) mutates `pages` only; sources are never modified.
3. Rendering: `render.ts` loads each source once in pdf.js and renders a `PageRef` with `rotation = sourceRotation + userRotation`. The editor draws annotations in an SVG overlay sized to the canvas.
4. Save: `exportPdf(pages, sources)` copies pages with pdf-lib in order, sets `/Rotate`, then draws annotations inside a `q <cm> ... Q` block using `displayToUserMatrix` so display-space coordinates land correctly on rotated pages.

## Coordinate systems
- **Canvas pixels**: what pointer events give you (origin top-left, y down). `scale` = pixels per point.
- **Display space**: points, origin bottom-left of the page *as displayed*. Annotations are stored here. `geometry.ts` converts both ways.
- **PDF user space**: what pdf-lib draws in. Only `export.ts` deals with it, via one matrix per page.

## Security
Electron runs with `contextIsolation`, `sandbox`, no `nodeIntegration`; the preload exposes a tiny typed bridge (`window.pdfEditor`). The production bundle is served from a privileged `app://` scheme rather than `file://`. A CSP is set in `index.html`.
