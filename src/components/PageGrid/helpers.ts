/**
 * Pure helpers for the page grid. No DOM, no React, no store imports, so they
 * run under Vitest in Node (tests/unit/page-grid-helpers.test.ts).
 *
 * All functions work on an ordered list of page ids (document order).
 */

export type MovePlan =
  | { kind: 'single'; fromIndex: number; toIndex: number }
  | { kind: 'multi'; ids: string[]; toIndex: number };

/**
 * Translate a dnd-kit drop (`activeId` dropped over `overId`) into a store
 * call. When the dragged page is part of the current selection, the whole
 * selection moves as a block (document order preserved) and lands where the
 * dragged page was dropped: after the hovered page when dragging towards the
 * end of the document, before it when dragging towards the start. Returns
 * `null` when nothing should move.
 *
 * `toIndex` of a `multi` plan follows the `store.movePages` contract: a position
 * in the *original* list that the store translates once the moving pages are
 * removed.
 */
export function planMove(
  order: readonly string[],
  selectedIds: readonly string[],
  activeId: string,
  overId: string,
): MovePlan | null {
  const fromIndex = order.indexOf(activeId);
  const toIndex = order.indexOf(overId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return null;

  const selected = new Set(selectedIds);
  const moving = selected.has(activeId) ? order.filter((id) => selected.has(id)) : [activeId];
  if (moving.length <= 1) return { kind: 'single', fromIndex, toIndex };

  return { kind: 'multi', ids: moving, toIndex: fromIndex < toIndex ? toIndex + 1 : toIndex };
}

/**
 * Ids between `anchorId` and `targetId` (inclusive, document order). Without a
 * usable anchor only the target is returned. Unknown target → empty list.
 */
export function rangeSelect(order: readonly string[], anchorId: string | null, targetId: string): string[] {
  const target = order.indexOf(targetId);
  if (target < 0) return [];
  const anchor = anchorId ? order.indexOf(anchorId) : -1;
  if (anchor < 0) return [targetId];
  const lo = Math.min(anchor, target);
  const hi = Math.max(anchor, target);
  return order.slice(lo, hi + 1);
}

/** Union of two id lists, keeping the order of `a` and appending new ids from `b`. */
export function unionIds(a: readonly string[], b: readonly string[]): string[] {
  const seen = new Set(a);
  const out = [...a];
  for (const id of b) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Index to move the active page to for a navigation key, or `null` when the
 * key is not a navigation key. `columns` is 1 for the list variant.
 *
 * - Left/Right step by one page and clamp at the ends.
 * - Up/Down step by a row; at the top row Up stays put, at the last row Down
 *   stays put, and Down from a row above a partial last row goes to the last page.
 * - Home/End jump to the first/last page.
 * - With no current page (`current < 0`) forward keys go to the first page and
 *   backward keys to the last one.
 */
export function nextIndexForKey(key: string, current: number, count: number, columns: number): number | null {
  if (count <= 0) return null;
  const cols = Math.max(1, Math.floor(columns));
  const last = count - 1;
  const forward = key === 'ArrowRight' || key === 'ArrowDown' || key === 'Home';
  const backward = key === 'ArrowLeft' || key === 'ArrowUp' || key === 'End';
  if (!forward && !backward) return null;
  if (current < 0 || current > last) return forward ? 0 : last;

  switch (key) {
    case 'Home':
      return 0;
    case 'End':
      return last;
    case 'ArrowLeft':
      return Math.max(0, current - 1);
    case 'ArrowRight':
      return Math.min(last, current + 1);
    case 'ArrowUp':
      return current - cols >= 0 ? current - cols : current;
    case 'ArrowDown': {
      if (current + cols <= last) return current + cols;
      const row = Math.floor(current / cols);
      const lastRow = Math.floor(last / cols);
      return row < lastRow ? last : current;
    }
    default:
      return null;
  }
}

/**
 * Where "Insert blank page" puts the new page and which page its size is
 * copied from: after the last selected page (sized like it), otherwise at the
 * end (sized like the active page, or the default size when `refId` is null).
 */
export function blankInsertion(
  order: readonly string[],
  selectedIds: readonly string[],
  activeId: string | null,
): { index: number; refId: string | null } {
  const selected = new Set(selectedIds);
  let lastSelected = -1;
  for (let i = 0; i < order.length; i++) if (selected.has(order[i]!)) lastSelected = i;
  if (lastSelected >= 0) return { index: lastSelected + 1, refId: order[lastSelected]! };
  const refId = activeId && order.includes(activeId) ? activeId : null;
  return { index: order.length, refId };
}

/**
 * Thumbnail box for a page of display size `displayWidth × displayHeight`
 * (points): as wide as `maxWidth`, unless that would make it taller than
 * `maxHeight` (very tall pages), in which case it is scaled to fit the height.
 */
export function fitThumbSize(
  displayWidth: number,
  displayHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (!(displayWidth > 0) || !(displayHeight > 0)) {
    return { width: maxWidth, height: Math.round((maxWidth * 11) / 8.5) };
  }
  const scale = Math.min(maxWidth / displayWidth, maxHeight / displayHeight);
  return {
    width: Math.max(1, Math.round(displayWidth * scale)),
    height: Math.max(1, Math.round(displayHeight * scale)),
  };
}

/** Human-readable page count. */
export function formatPageCount(count: number): string {
  return `${count} ${count === 1 ? 'page' : 'pages'}`;
}
