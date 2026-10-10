# PDF Editor

A desktop PDF editor for Windows, macOS and Linux that also runs in the browser. Drop PDFs or images in, merge them, rearrange / rotate / delete / duplicate pages, add text, draw and highlight, cover content with whiteout, sign, and save. Everything happens locally on your machine; no file ever leaves it.

![CI](../../actions/workflows/ci.yml/badge.svg)

## Get it

**Desktop app.** Download the installer for your OS from the repository's **Releases** page and follow [docs/INSTALL.md](docs/INSTALL.md) (the builds are unsigned, so each OS shows a one-time "unknown developer" prompt; the doc explains the one click to get past it).

| OS | Download |
| --- | --- |
| Windows 10/11 | `pdf-editor-<version>-win-x64.exe` (installer) or `…-win-x64-portable.exe` (no install) |
| macOS 12+ | `pdf-editor-<version>-mac-arm64.dmg` (Apple Silicon) or `…-mac-x64.dmg` (Intel) |
| Linux | `pdf-editor-<version>-linux-x86_64.AppImage` or `…-linux-amd64.deb` |

Releases are produced automatically by pushing a tag such as `v0.1.0` (see `.github/workflows/release.yml`).

**Web app.** The same editor is published to GitHub Pages from `main` by `.github/workflows/deploy-pages.yml` (enable *Settings → Pages → Source: GitHub Actions* once). It works in any modern browser and can be installed from the browser's "Install app" menu. Files are processed in the browser; saving uses the system save dialog where supported, otherwise a download.

## Using it

1. **Open**: drag files onto the window, click *Open*, use `Ctrl/Cmd+O`, or (desktop) double-click a PDF / *Open with*. Several files at once are merged in the order given. PNG, JPEG, WebP, GIF and BMP images become pages.
2. **Pages**: the left sidebar lists pages. Drag thumbnails to reorder (also in the *Pages* grid view, where you can multi-select with `Ctrl/Cmd`/`Shift`-click). Hover a thumbnail for rotate / duplicate / delete; the toolbar also inserts blank pages after the current one.
3. **Edit a page** in the main area:
   - **Select (V)** moves, resizes and deletes annotations; the toolbar options restyle the selected one.
   - **Text (T)** click to place a text box, type, `Esc` or click away to finish. Choose font, size and colour in the toolbar.
   - **Pen (P)**, **Highlighter (H)**, **Rectangle (R)**, **Highlight box**, **Whiteout (W)** (covers existing content).
   - **Sign (G)** draws, types or uploads a signature once, keeps it for reuse, then click to place it. Drag the corner to resize.
4. **Save** with `Ctrl/Cmd+S` or the *Save* button. The output is a standard, flattened PDF. *Save selected pages as…* exports a subset.

Undo/redo: `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` (or `Ctrl+Y`). Zoom: `Ctrl/Cmd` + `+` / `-` / `0`, or `Ctrl`+wheel. `Delete` removes the selected annotation (or selected pages in the grid view).

Limits worth knowing: password-protected PDFs must be unlocked first; existing PDF text cannot be edited in place (use whiteout plus a text box); form fields are flattened in the output.

## Development

```bash
npm install          # also copies pdf.js font data into public/pdfjs
npm run dev          # Electron app with hot reload
npm run dev:web      # renderer only, in your browser (http://localhost:5173)
npm run check        # typecheck + lint + unit tests
npm run test:e2e     # Playwright UI tests (starts the Vite server itself)
npm run build && xvfb-run -a npm run test:e2e:electron   # Electron smoke tests (Linux)
npm run package      # installers into release/ (package:dir for an unpacked build)
```

Architecture, coordinate systems and conventions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Agent instructions: [CLAUDE.md](CLAUDE.md).

### Resuming work across sessions

The repository is designed so that work can stop and restart without repeating anything. `docs/PROGRESS.md` is the hand-off ledger: it lists every milestone, what is done, what is in progress and what was decided. Each milestone is committed and pushed as soon as it is finished. To continue: pull, `npm install`, `npm run check`, read the ledger, pick up the first unfinished item.

## Stack

Electron 39 · Vite 7 · React 19 · TypeScript 5.9 · [pdf.js](https://mozilla.github.io/pdf.js/) (rendering) · [pdf-lib](https://pdf-lib.js.org/) (editing/writing) · Zustand (state, undo/redo) · dnd-kit (page reordering) · Vitest + Playwright (tests) · electron-builder (installers).

## License

MIT
