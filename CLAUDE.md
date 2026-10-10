# PDF Editor — agent instructions

Cross-platform desktop PDF editor (Electron + React + TypeScript). pdf.js renders, pdf-lib writes.

## Start here on every session
1. Read `docs/PROGRESS.md`. It says what is done, what is in progress and what is next. Do not redo finished milestones.
2. `npm install && npm run check` before changing anything.
3. Work milestone by milestone. After each one: update `docs/PROGRESS.md` (tick the box, note decisions), commit, push.

## Commands
- `npm run dev` — Electron + Vite with HMR. `npm run dev:web` — renderer only, in the browser.
- `npm run check` — typecheck + lint + unit tests (must be green before every commit).
- `npm run test:e2e` — Playwright web tests (starts the Vite server itself).
- `npm run build && xvfb-run -a npm run test:e2e:electron` — Electron smoke tests on headless Linux.
- `npm run package` — installers via electron-builder (`package:dir` for an unpacked build).

## Conventions
- Annotation coordinates are **display space** (see `src/core/types.ts` header). Never store canvas pixels.
- Renderer code must not import from `electron` or Node; go through `src/platform`.
- Keep `src/core` free of DOM/React so it stays unit-testable in Node (pdf.js rendering lives in `src/core/render.ts`, which is browser-only and excluded from unit tests).
- Prefer small, focused commits with messages that name the milestone (e.g. `M3: pen and highlighter tools`).
- Tests: unit tests in `tests/unit/*.test.ts` (Vitest, Node), e2e in `tests/e2e/*.spec.ts` (Playwright). Generate PDF fixtures with `tests/helpers/make-pdf.ts`; do not commit binary PDFs.
