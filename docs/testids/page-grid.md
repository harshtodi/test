# Page grid — test ids (module M2)

Component: `src/components/PageGrid/PageGrid.tsx` (`<PageGrid variant="list" | "grid" />`).
The list variant is the 220px sidebar next to the editor (`[data-testid="sidebar"]`);
the grid variant fills the arrange view (`.grid-pane`). Both render the same markup.

## Container

| test id | element | notes |
| --- | --- | --- |
| `page-grid` | root `div` | `data-variant="list"` or `"grid"`. |
| `page-grid-list` / `page-grid-grid` | body `div` below the header (wraps the listbox) | exactly one of them exists, matching the variant. These are the ids the original stub exposed and `tests/e2e/pages.spec.ts` already targets (`page-grid-grid` after switching to the arrange view). |
| `page-grid-header` | sticky header bar | contains the counters and the toolbar below. |
| `page-count` | `span` | text `N pages` (`1 page` for a single page). |
| `selected-count` | `span` | text `k selected`; **only rendered when k > 0**. |
| `page-grid-items` | `div[role=listbox]` | the sortable list. `aria-multiselectable="true"`. Clicking its empty background (padding, not a tile) clears the selection. Keyboard handling lives here (see below). |

## Header toolbar (`role=toolbar`, inside `page-grid-header`)

| test id | action | enabled when |
| --- | --- | --- |
| `grid-select-all` | selects every page; when all pages are already selected it **deselects all** instead (`aria-pressed="true"` in that state, label/title switch to "Deselect all") | at least one page |
| `grid-rotate-ccw` | `rotatePages(selected, -90)` | selection non-empty |
| `grid-rotate-cw` | `rotatePages(selected, +90)` | selection non-empty |
| `grid-duplicate` | `duplicatePages(selected)` — the store then selects the new copies | selection non-empty |
| `grid-delete` | `removePages(selected)` | selection non-empty |
| `grid-insert-blank` | inserts a blank page after the **last selected** page (or at the end when nothing is selected), sized like that page (else like the active page, else Letter). The new page becomes selected and active. On failure a `notice-error` toast is shown. | always |

In the list variant the buttons are icon-only (labels hidden with CSS); the `title`/`aria-label`
attributes are identical in both variants.

## One tile

| test id | element | notes |
| --- | --- | --- |
| `page-thumb` | tile root `div[role=option]` | attributes: `data-page-index` (0-based document position), `data-page-id`, `data-selected="true|false"`, `data-active="true|false"`, `aria-selected`, `title="<file name> · page <n>"` (n = page number inside the source file). Roving tabindex: only the active tile has `tabindex="0"` (the first tile when no page is active); the others have `-1`. Class `dragging` while it is being dragged; class `drag-member` on the *other* selected tiles while a multi-page selection is being dragged. |
| `page-thumb-image` | `img` | present once the thumbnail for the page's **current** rotation has rendered (`src` is a PNG data URL, 1.5× the frame size). Absent while loading or on error. Tiles outside the scroll container (±320px) are not rendered until scrolled near. After a rotation it disappears and comes back once the page has been re-rendered — wait for it when you need the fresh image. |
| `page-thumb-stale` | `img` | shown instead of `page-thumb-image` while a re-render is pending for a page that already had a thumbnail (after rotate): the previous image, rotated/scaled with an inline CSS transform. |
| `page-thumb-placeholder` | `div` | shown while loading when there is no previous image; gets class `error` if rendering failed ("Preview unavailable"). |
| `page-thumb-badge` | `span` | the 1-based page number. |
| `thumb-rotate-ccw` | button | `rotatePages([id], -90)` |
| `thumb-rotate-cw` | button | `rotatePages([id], +90)` |
| `thumb-duplicate` | button | `duplicatePages([id])` |
| `thumb-delete` | button | `removePages([id])` |

Exactly one of `page-thumb-image`, `page-thumb-stale`, `page-thumb-placeholder` is present in a tile at any time.

The four tile buttons sit in a toolbar that is `opacity:0; pointer-events:none` until the tile is
hovered, focused-within or selected. In Playwright, `tile.hover()` then `tile.getByTestId('thumb-delete').click()`
works; the buttons stop propagation so they never select or start a drag. Always scope them to a
tile: `page.locator('[data-testid="page-thumb"][data-page-index="2"]').getByTestId('thumb-delete')`.

## Drag preview

| test id | element | notes |
| --- | --- | --- |
| `page-drag-overlay` | `DragOverlay` content (portaled to `document.body`) | present only during a drag. `data-page-id` of the dragged page. Its image/placeholder carries no test ids. |
| `page-drag-count` | `span` inside the overlay | `"<k> pages"`; only when the dragged page is part of a multi-page selection. |

## Interactions

Mouse
- Click: select only that page (`togglePageSelection(id, false)`) and make it active.
- Ctrl/Cmd+click: toggle the page in the selection. Shift+click: select the range from the last
  plainly clicked page (anchor) to this one (Ctrl+Shift adds the range). If the anchor page no longer
  exists the range starts at the active page. Clicking always sets the active page.
- Double-click: `setActivePage` + `setViewMode('editor')`.
- Drag (pointer must move ≥ 6px — a plain click never starts a drag): reorders. If the dragged page is
  selected together with others, the whole selection moves as a block in document order
  (`movePages`), landing after the hovered page when dragging down and before it when dragging up.
  A single page uses `movePage(from, to)` (dnd-kit `arrayMove` semantics). The drop records one undo step.
  The selection survives the drop (the click that may follow a drop is ignored).

  Playwright recipe: `mouse.move(centre of source) → mouse.down() → mouse.move(...) in ≥ 2 steps to the centre
  of the target (optionally up to 30% of a tile past it in the drag direction) → mouse.up()`.
  **Pitfall — auto-scroll:** dnd-kit scrolls the sidebar/grid pane while the pointer is within 20% of the pane's
  height from its top/bottom edge (or outside it). In the default 1280×720 Playwright viewport the list variant
  only shows ~3 portrait tiles, so dropping on tile 3 of a 4-page document lands near the bottom edge, the
  list scrolls during the 100ms wait and the drop resolves one slot further than intended. Either drag in
  the grid variant (`tb-view-grid` first — a 4-page document fits in one row, nothing scrolls), use a taller
  viewport (`page.setViewportSize({ width: 1280, height: 1600 })`), or make sure both tiles are fully visible
  and the drop point is well inside the pane. After a drop, tiles animate into place for ~200ms; wait
  before measuring positions for a second drag.

Keyboard (focus a tile first; the active tile is the tabbable one)
- Arrow keys move the active page (Up/Down by a row in the grid variant), Home/End jump; the selection
  follows (Shift+Arrow extends the range from the anchor). Focus follows the active tile.
- Enter: open the active page in the editor. Ctrl/Cmd+A: select all.
- Space: pick the focused tile up (dnd-kit keyboard sensor); arrows move it; Space or Enter drops it
  (Enter as a drop key does not open the editor); Escape cancels. Focus returns to the moved tile.
- Delete/Backspace is handled globally by `src/app/shortcuts.ts` (grid view mode only). When the
  focused tile is removed (Delete, undo) and the list owned keyboard focus, focus moves to the new active
  tile so arrow keys keep working. Focus is never taken from elements outside the list.

The list variant scrolls the active tile into view (`scrollIntoView({block:'nearest'})`) whenever
`activePageId` changes; the sticky header height is accounted for via `scroll-margin-top`.

## Updates after M7 (hardening)

- **Touch**: press and hold a tile ~250 ms, then drag; moving more than 8 px before that scrolls instead.
- **Keyboard**: `Delete`/`Backspace` with focus inside `page-grid-items` removes the selected pages and stops propagation; the global handler (`src/app/shortcuts.ts`) covers the rest and ignores keys that were already handled (`defaultPrevented`).
- The grid header "Insert blank page" and the toolbar button use the same target rule (after the last selected page in document order).
