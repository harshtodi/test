# Toolbar & signature dialog — test ids (module M4)

Components: `src/components/Toolbar/Toolbar.tsx` (`<Toolbar onOpen={...} />`) and
`src/components/Signature/SignatureDialog.tsx` (`<SignatureDialog />`, rendered by the Toolbar into a
portal on `document.body`; open state is `store.signatureDialogOpen`).

All toolbar buttons are icon-only with a `title` tooltip (including the shortcut where one exists) and an
`aria-label`. Disabled buttons carry the `disabled` attribute, so Playwright's `click()` waits for them.

## Toolbar container

| test id | element | notes |
| --- | --- | --- |
| `toolbar` | `header[role=toolbar]` | wraps to a second row below ~1180px (text labels collapse to icons; the short hints in `tool-options` stay). |

## 1. File group

| test id | element | behaviour |
| --- | --- | --- |
| `tb-open` | button | calls the `onOpen` prop (App opens the native dialog or clicks `file-input`). |
| `tb-save` | button | `saveDocument()`. `data-dirty="true|false"`; shows a dot when there are unsaved changes. Disabled when there are no pages. |
| `tb-menu` | button (`aria-haspopup=menu`, `aria-expanded`) | toggles the overflow dropdown `tb-menu-dropdown` (`role=menu`). Closes on outside pointerdown, Escape, or after picking an item (focus returns to `tb-menu`). |
| `tb-save-selected` | menuitem | `saveSelectedPages()` (selected pages, else the active page). Disabled without pages. |
| `tb-close-doc` | menuitem | `window.confirm(...)` → `clearDocument()` + `releaseAllSources()`. Disabled without pages. In Playwright, handle the dialog with `page.once('dialog', d => d.accept())`. |
| `tb-filename` | button | shows `store.outputName` as text (use `toContainText`). Click to edit. Hidden below 760px. |
| `tb-filename-input` | input | present only while editing. Enter/blur commits via `setOutputName(normalizeOutputName(...))`: illegal characters stripped, `.pdf` appended; empty keeps the old name. Escape cancels. Enter/Escape return focus to `tb-filename`. |

## 2. History

| test id | behaviour |
| --- | --- |
| `tb-undo` | `store.undo()`; disabled when `past` is empty. |
| `tb-redo` | `store.redo()`; disabled when `future` is empty. |

## 3. View & page operations

| test id | element | behaviour |
| --- | --- | --- |
| `tb-view-grid` | `button[role=radio]` | `setViewMode('grid')`; `aria-checked`/`.active` when current. |
| `tb-view-editor` | `button[role=radio]` | `setViewMode('editor')`. |
| `tb-prev-page` | button | **editor mode only.** Active page ← previous page (`setActivePage` + `selectPages([id])`). Disabled on the first page. |
| `tb-page-indicator` | `span` | **editor mode only.** Text `"<current> / <total>"`, 1-based (e.g. `2 / 5`); `– / 0` without pages. |
| `tb-next-page` | button | **editor mode only.** Active page → next page. Disabled on the last page. |
| `tb-rotate-ccw` | button | `rotatePages(target, -90)` |
| `tb-rotate-cw` | button | `rotatePages(target, +90)` |
| `tb-delete-page` | button | `removePages(target)` |
| `tb-insert-blank` | button | inserts a blank page **after the last target page**, sized like that page's display size (Letter fallback). The new page becomes active and selected. Errors surface as a `notice-error`. |

`target` = in **editor** mode the active page; in **grid** mode the selected pages when the selection is
non-empty, else the active page (exported helper `targetPageIds(state)`). The four page buttons are
disabled when there is no target.

## 4. Tools (`role=radiogroup`; each button `role=radio`, `aria-checked`, `.active`)

Enabled only in editor mode with at least one page.

| test id | tool | shortcut |
| --- | --- | --- |
| `tool-select` | `select` | V |
| `tool-text` | `text` | T |
| `tool-pen` | `pen` | P |
| `tool-highlighter` | `highlighter` | H |
| `tool-rect` | `rect` | R |
| `tool-highlight-box` | `highlight-box` | — |
| `tool-whiteout` | `whiteout` | W |
| `tool-signature` | `signature` | G. Sets the tool; **opens the signature dialog when `store.currentSignature` is null**, otherwise just selects the tool. |
| `tool-signature-pick` | caret | always opens the signature dialog (pick another / saved signature). Does not change the tool by itself. |

## 5. Tool options (`tool-options`, editor mode only)

Container `tool-options` has `data-editing="tool"` (editing the defaults for the current tool) or
`data-editing="annotation"` (an annotation is selected: the controls patch **that** annotation via
`updateAnnotation(pageId, id, patch, true)` — one undo step per change). Nothing renders for the select
tool without a selection, or in grid view.

| test id | shown for | bound to |
| --- | --- | --- |
| `opt-color-black`, `opt-color-red`, `opt-color-blue`, `opt-color-green` | pen, rect, text (and selected ink / stroked rect / text annotations) | `toolSettings.color` (pen/rect), `toolSettings.textColor` (text); or the annotation's `color` / `strokeColor`. Active swatch has `.active` and `aria-checked=true`. |
| `opt-color-custom` | pen, rect, text | `input[type=color]` (hex; Playwright: `fill('#00ff00')`). For a selected annotation, a burst of changes within 800ms is one undo step; the burst timer is per annotation (the options remount when the selection changes). |
| `opt-color-yellow`, `opt-color-green`, `opt-color-pink`, `opt-color-blue` | highlighter, highlight-box (and selected highlighter ink / highlight-box rects) | `toolSettings.highlighterColor`; or the annotation's `color` / `fillColor`. (Note `blue`/`green` ids are shared with the ink palette; only one palette is ever rendered at a time.) |
| `opt-stroke-width` | pen, rect, highlighter (and selected ink / stroked rects) | `select`; options `1,2,3,5,8` pt for pen/rect, `8,14,20` for highlighter (the current value is added if not listed). `toolSettings.strokeWidth` / `highlighterWidth` or the annotation's `strokeWidth`. |
| `opt-font` | text | `select` with values `Helvetica`, `Helvetica-Bold`, `TimesRoman`, `Courier`. |
| `opt-font-size` | text | `select` with `8 … 48`. |
| `opt-delete-annotation` | any selected annotation | `removeAnnotation(pageId, id)`. |

Selected whiteout rectangles and images show only `opt-delete-annotation`.

## 6. Zoom (editor mode only)

| test id | behaviour |
| --- | --- |
| `tb-zoom-out` | `setZoom(zoom / 1.25)`; disabled at the 25% floor. |
| `tb-zoom-level` | button showing `Math.round(zoom*100)%`; click → `setZoom(1)` (fit width). |
| `tb-zoom-in` | `setZoom(zoom * 1.25)`; disabled at the 400% ceiling. |

---

## Signature dialog

Modal (`role=dialog`, `aria-modal=true`). Escape and a pointerdown on the backdrop (`signature-backdrop`)
close it; Tab cycles inside the dialog; every keydown inside it is stopped before the global shortcuts, and
focus is pulled back into the dialog if the focused element unmounts (e.g. after `sig-saved-remove`).
Cancelling with no `currentSignature` while the tool is `signature` resets the tool to `select`. The three
pads stay mounted while switching tabs.

| test id | element | notes |
| --- | --- | --- |
| `signature-dialog` | dialog root | absent from the DOM when closed (`toHaveCount(0)`). |
| `signature-backdrop` | backdrop | pointerdown on it (not on a child) cancels. |
| `sig-close` | button | same as Cancel. |
| `sig-tab-draw`, `sig-tab-type`, `sig-tab-upload` | `button[role=tab]` | `aria-selected`; Arrow keys / Home / End move between tabs. Draw is the default tab. |
| `sig-canvas` | `canvas` (Draw tab) | 600×200 CSS px (shrinks to the dialog width, keeping 3:1), bitmap scaled by DPR, `touch-action:none`. Draw with `mouse.move/down/move/up`. |
| `sig-color-black`, `sig-color-blue` | `button[role=radio]` | ink color of the Draw **and** Type tabs (each tab has its own pair; scope to the visible panel). Recolors the whole drawing. |
| `sig-width` | `select` (Draw tab) | pen width `2`, `3`, `4` px. |
| `sig-undo-stroke` | button (Draw tab) | removes the last stroke; disabled when empty. |
| `sig-clear` | button (Draw tab) | clears the drawing; disabled when empty. |
| `sig-type-input` | `input[type=text]` (Type tab) | `fill('Name')` renders the preview. |
| `sig-type-canvas` | `canvas` (Type tab) | preview in the script font stack at 56px; width grows with the text. |
| `sig-upload-input` | `input[type=file]` (`accept=image/png,image/jpeg`) | `setInputFiles(...)`. Visually hidden inside the "Choose image…" label. |
| `sig-upload-name` | `span` | the chosen file name (or a hint). |
| `sig-upload-canvas` | `canvas` | the uploaded image (longest side capped at 1600px); has class `hidden` until a file is chosen. |
| `sig-upload-transparent` | checkbox | knocks out near-white pixels; defaults **on** for JPEG, off for PNG. Disabled until a file is chosen. |
| `sig-upload-error` | `p[role=alert]` | shown when the file cannot be decoded. |
| `sig-error` | `p[role=alert]` | shown when "Use" is pressed with nothing to use (only reachable with a fully transparent upload). |
| `sig-use` | primary button | **disabled until the active tab has ink.** Crops the active pad to the ink bounding box and adds an 8 CSS px (×DPR) transparent margin on every side, even where the ink touched the canvas edge → `setCurrentSignature({dataUrl,width,height})` (bitmap pixels), `setTool('signature')`, saves to localStorage, closes. |
| `sig-cancel` | button | closes without changes. |
| `sig-saved-list` | `ul` | present only when there are saved signatures. |
| `sig-saved-item` | button (one per saved signature, newest first) | `data-signature-id`. Click = use it (sets `currentSignature`, tool `signature`, closes). |
| `sig-saved-remove` | button (one per saved signature) | forgets that signature. |

Saved signatures live in `localStorage["pdf-editor.signatures"]` as a JSON array of
`{ id, dataUrl, width, height, createdAt }`, newest first, max 8, de-duplicated by image. Corrupt JSON is
treated as an empty list. Pure helpers in `src/components/Signature/signature-store.ts`
(`parseSignatures`, `addToList`, `removeFromList`, `saveSignature`, `removeSignature`, `loadSignatures`).
