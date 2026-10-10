# M3 page editor — test ids

Module: `src/components/Editor/` (`PageEditor.tsx`, `PageCanvas.tsx`, `AnnotationLayer.tsx`,
`TextEditorOverlay.tsx`, `useEditorInteractions.ts`). All coordinates below are CSS px in the
viewport; the overlay converts them to display space (points, origin bottom-left) itself.

## Elements

| test id | element | notes |
| --- | --- | --- |
| `page-editor` | root `<div>` | Fills `.editor-pane`. `data-page-id`, `data-scale` (CSS px per point, 4 decimals). Present (with the empty hint) even when no page is active. |
| `editor-empty-hint` | `<p>` | Shown when `activePageId` is null ("Select a page") or the page's source is missing. |
| `page-surface` | `<div>` | The page box, exactly `displayWidth×scale` by `displayHeight×scale` px. Holds the canvas, overlay and text editor. |
| `page-canvas` | `<canvas>` | pdf.js bitmap. `data-render-status` = `rendering` \| `done` \| `error`; `done` means the bitmap matches the *current* `data-scale` (after a zoom it reads `rendering` again until the debounced re-render lands), so wait for `done` before pixel assertions. `data-render-scale` = the scale the bitmap was last rendered at (absent before the first render). |
| `page-render-error` | `<div role="alert">` | Only when pdf.js failed for this page. |
| `annotation-layer` | `<svg>` | Pointer target for every tool (`touch-action: none`). Same size/position as the canvas, so `boundingBox()` fractions map 1:1 onto the page. `data-tool` = current tool, `data-cursor` = cursor being shown (`default`, `pointer`, `move`, `text`, `crosshair`, `copy`, `nwse-resize`, `nesw-resize`). |
| `annotation` | `<g>` (ink, text) / `<rect>` / `<image>` | One per annotation, in draw order. `data-annotation-id`, `data-annotation-type` = `text` \| `ink` \| `rect` \| `image`. Text `<g>` contains one `<text>` per non-empty line. A text annotation being edited is *not* rendered (the textarea replaces it). |
| `ink-preview` | `<path>` | Live stroke while the pen/highlighter is down; `d=""` otherwise. |
| `rect-preview` | `<rect>` | Live rectangle while a rect/highlight-box/whiteout drag is in progress (`data-mode`); 0×0 otherwise. |
| `selection` | `<g>` | Wraps the selection UI for the selected annotation (`data-annotation-id`). |
| `selection-box` | `<rect>` | Dashed accent outline, 3 px outside the annotation bounds. |
| `resize-handle` | `<rect>` ×4 | Only for `rect`/`image` annotations. `data-corner` = `nw` \| `ne` \| `sw` \| `se` (screen orientation: `n` = top). Drag one to resize; images keep their aspect ratio. |
| `text-editor-input` | `<textarea>` | Inline text editor (`data-annotation-id`). Auto-focused on open. Commit with `Escape`, `Ctrl/Cmd+Enter` or blur; plain `Enter` inserts a newline. `Ctrl/Cmd+S` commits first and then lets the global save shortcut run, so a save made mid-edit contains the text. |

## Behaviour cheat-sheet for e2e authors

- **Tool switching** is owned by the Toolbar (`tool-*` ids) and the global shortcuts (`v t p h r w g`).
- **Text**: with the text tool, `mouse.click(x, y)` opens the editor with the click point as the
  text's top-left. `fill('…')` then `keyboard.press('Escape')` commits; an empty editor adds nothing.
  After committing, the tool is `select` and the new annotation is selected. Clicking an existing
  text annotation with the text tool, or double-clicking it with the select tool, re-opens the editor.
- **Pen / highlighter / rect / highlight-box / whiteout**: press, move, release on
  `annotation-layer`. A pen click without movement makes a dot. Rectangles under 2×2 pt are dropped.
- **Select**: click an annotation to select, click empty space to deselect, drag ≥3 px to move
  (one undo step per drag). Dragging a `resize-handle` ≥3 px resizes (one undo step; a press-and-release or sub-threshold
  jitter on a handle records nothing). The point where the handle was grabbed stays under the
  pointer, so grabbing a handle off-centre does not make the box jump. Delete/Backspace/Escape are the global shortcuts.
- **Pointer robustness**: one pointer drives the overlay at a time; extra touch/pen pointers are
  ignored while a gesture is in progress. `pointercancel` drops the gesture; an unexpected loss of
  pointer capture keeps what was drawn. A mouse press arriving while a stale gesture is still open
  (its pointerup was never delivered) closes that gesture first, so the overlay never gets stuck.
- **Signature**: a click with the signature tool and no `currentSignature` opens the signature
  dialog (`setSignatureDialogOpen(true)`), nothing else. With a signature it places an `image`
  annotation centred on the click (width = min(200 pt, 40 % of page width)), then switches to
  `select` with it selected.
- **Zoom**: Ctrl/Cmd + wheel on `page-editor` changes `store.zoom`; read `data-scale` to confirm.
- **Viewport gotcha**: at fit-to-width a Letter page is ~1.3× the pane width tall, so in a
  1280×720 viewport anything below ~45 % of `annotation-layer`'s height is off-screen and
  `page.mouse.click(x, y)` there silently does nothing. Either use a taller viewport
  (e.g. 1280×1500), zoom out first, or click via `locator.click({ position })`, which scrolls
  the target into view (the overlay's bounding box then changes, so re-read it after scrolling).

## Updates after M7 (hardening)

- `annotation-layer`: `touch-action` is `none` for every tool except the select tool with nothing selected, where it is `pan-x pan-y pinch-zoom` so touch users can scroll the page; new attribute `data-selected` = id of the selected annotation.
- Moving/resizing re-renders only the dragged annotation (the rest of the layer is memoised); the pointer gesture is cancelled when the active page changes.
- Switching to a page of a different size renders at that page's own fit scale from the first frame; toolbar/keyboard/menu zoom keeps the viewport centre.
- Clicking a toolbar option while the inline text editor is open applies the style to the text being typed instead of committing it.
- The on-screen preview of a text annotation shows the same `?` substitutions the export would make (`exportPreviewText`); non-WinAnsi text is rasterised on save (see `src/app/text-raster.ts`).
