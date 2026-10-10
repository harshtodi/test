import { beforeEach, describe, expect, it } from 'vitest';
import {
  blankInsertion,
  fitThumbSize,
  formatPageCount,
  nextIndexForKey,
  planMove,
  rangeSelect,
  unionIds,
} from '@/components/PageGrid/helpers';
import { useEditorStore } from '@/state/store';
import type { PageRef } from '@/core/types';

const ORDER = ['A', 'B', 'C', 'D', 'E'];

function mkPages(ids: string[]): PageRef[] {
  return ids.map((id, i) => ({ id, sourceId: 'src', sourceIndex: i, rotation: 0, annotations: [] }));
}

function currentOrder(): string[] {
  return useEditorStore.getState().pages.map((p) => p.id);
}

/** Run a plan through the real store so the helper and the store contract are tested together. */
function applyPlan(order: string[], selected: string[], active: string, over: string): string[] {
  useEditorStore.setState({ pages: mkPages(order), selectedPageIds: selected, past: [], future: [] });
  const plan = planMove(order, selected, active, over);
  if (!plan) return currentOrder();
  const s = useEditorStore.getState();
  if (plan.kind === 'single') s.movePage(plan.fromIndex, plan.toIndex);
  else s.movePages(plan.ids, plan.toIndex);
  return currentOrder();
}

describe('planMove', () => {
  beforeEach(() => {
    useEditorStore.getState().clearDocument();
  });

  it('returns null for unknown ids or a drop on itself', () => {
    expect(planMove(ORDER, [], 'A', 'A')).toBeNull();
    expect(planMove(ORDER, [], 'Z', 'A')).toBeNull();
    expect(planMove(ORDER, [], 'A', 'Z')).toBeNull();
  });

  it('moves a single page like dnd-kit arrayMove (down and up)', () => {
    expect(planMove(ORDER, [], 'A', 'D')).toEqual({ kind: 'single', fromIndex: 0, toIndex: 3 });
    expect(applyPlan(ORDER, [], 'A', 'D')).toEqual(['B', 'C', 'D', 'A', 'E']);
    expect(applyPlan(ORDER, [], 'E', 'B')).toEqual(['A', 'E', 'B', 'C', 'D']);
  });

  it('treats a selected-but-not-dragged selection as a single move', () => {
    // B and D are selected, but the user drags the unselected A.
    expect(planMove(ORDER, ['B', 'D'], 'A', 'C')?.kind).toBe('single');
    expect(applyPlan(ORDER, ['B', 'D'], 'A', 'C')).toEqual(['B', 'C', 'A', 'D', 'E']);
  });

  it('moves the whole selection as a block, in document order, after the hovered page when dragging down', () => {
    const plan = planMove(ORDER, ['C', 'A'], 'A', 'D');
    expect(plan).toEqual({ kind: 'multi', ids: ['A', 'C'], toIndex: 4 });
    expect(applyPlan(ORDER, ['C', 'A'], 'A', 'D')).toEqual(['B', 'D', 'A', 'C', 'E']);
  });

  it('moves the block before the hovered page when dragging up', () => {
    expect(planMove(ORDER, ['C', 'E'], 'E', 'B')).toEqual({ kind: 'multi', ids: ['C', 'E'], toIndex: 1 });
    expect(applyPlan(ORDER, ['C', 'E'], 'E', 'B')).toEqual(['A', 'C', 'E', 'B', 'D']);
  });

  it('can move a block to the very end and the very start', () => {
    expect(applyPlan(ORDER, ['A', 'B'], 'A', 'E')).toEqual(['C', 'D', 'E', 'A', 'B']);
    expect(applyPlan(ORDER, ['D', 'E'], 'E', 'A')).toEqual(['D', 'E', 'A', 'B', 'C']);
  });

  it('keeps the document unchanged when the block is dropped on one of its own pages next to it', () => {
    // A and B selected, A dropped onto B: nothing sensible changes.
    expect(applyPlan(ORDER, ['A', 'B'], 'A', 'B')).toEqual(ORDER);
  });

  it('records one undo step for a multi-page move', () => {
    applyPlan(ORDER, ['A', 'C'], 'A', 'D');
    expect(useEditorStore.getState().past).toHaveLength(1);
    useEditorStore.getState().undo();
    expect(currentOrder()).toEqual(ORDER);
  });
});

describe('rangeSelect', () => {
  it('selects the inclusive range in either direction', () => {
    expect(rangeSelect(ORDER, 'B', 'D')).toEqual(['B', 'C', 'D']);
    expect(rangeSelect(ORDER, 'D', 'B')).toEqual(['B', 'C', 'D']);
    expect(rangeSelect(ORDER, 'C', 'C')).toEqual(['C']);
  });

  it('falls back to the target alone without a usable anchor', () => {
    expect(rangeSelect(ORDER, null, 'C')).toEqual(['C']);
    expect(rangeSelect(ORDER, 'gone', 'C')).toEqual(['C']);
  });

  it('returns nothing for an unknown target', () => {
    expect(rangeSelect(ORDER, 'A', 'nope')).toEqual([]);
  });
});

describe('unionIds', () => {
  it('keeps order and drops duplicates', () => {
    expect(unionIds(['C', 'A'], ['A', 'B', 'C', 'D'])).toEqual(['C', 'A', 'B', 'D']);
    expect(unionIds([], [])).toEqual([]);
  });
});

describe('nextIndexForKey', () => {
  it('ignores non-navigation keys and empty lists', () => {
    expect(nextIndexForKey('a', 0, 5, 1)).toBeNull();
    expect(nextIndexForKey('Enter', 0, 5, 1)).toBeNull();
    expect(nextIndexForKey('ArrowDown', 0, 0, 1)).toBeNull();
  });

  it('steps through a list (one column) and clamps at the ends', () => {
    expect(nextIndexForKey('ArrowDown', 0, 5, 1)).toBe(1);
    expect(nextIndexForKey('ArrowUp', 0, 5, 1)).toBe(0);
    expect(nextIndexForKey('ArrowRight', 4, 5, 1)).toBe(4);
    expect(nextIndexForKey('ArrowLeft', 4, 5, 1)).toBe(3);
    expect(nextIndexForKey('Home', 3, 5, 1)).toBe(0);
    expect(nextIndexForKey('End', 1, 5, 1)).toBe(4);
  });

  it('moves by rows in a grid', () => {
    // 3 columns, 7 items: rows [0 1 2] [3 4 5] [6]
    expect(nextIndexForKey('ArrowDown', 1, 7, 3)).toBe(4);
    expect(nextIndexForKey('ArrowUp', 4, 7, 3)).toBe(1);
    expect(nextIndexForKey('ArrowUp', 1, 7, 3)).toBe(1); // already on top row
    expect(nextIndexForKey('ArrowDown', 4, 7, 3)).toBe(6); // partial last row → last page
    expect(nextIndexForKey('ArrowDown', 6, 7, 3)).toBe(6); // already on the last row
    expect(nextIndexForKey('ArrowRight', 2, 7, 3)).toBe(3); // wraps to the next row like reading order
  });

  it('starts from the first or last page when nothing is active', () => {
    expect(nextIndexForKey('ArrowDown', -1, 5, 2)).toBe(0);
    expect(nextIndexForKey('ArrowRight', -1, 5, 2)).toBe(0);
    expect(nextIndexForKey('ArrowUp', -1, 5, 2)).toBe(4);
    expect(nextIndexForKey('End', -1, 5, 2)).toBe(4);
  });

  it('tolerates a bogus column count', () => {
    expect(nextIndexForKey('ArrowDown', 0, 3, 0)).toBe(1);
    expect(nextIndexForKey('ArrowDown', 0, 3, -4)).toBe(1);
  });
});

describe('blankInsertion', () => {
  it('inserts after the last selected page and copies its size', () => {
    expect(blankInsertion(ORDER, ['D', 'B'], 'A')).toEqual({ index: 4, refId: 'D' });
  });

  it('inserts at the end sized like the active page when nothing is selected', () => {
    expect(blankInsertion(ORDER, [], 'C')).toEqual({ index: 5, refId: 'C' });
  });

  it('inserts at the end with no reference when nothing is active or selected', () => {
    expect(blankInsertion(ORDER, [], null)).toEqual({ index: 5, refId: null });
    expect(blankInsertion(ORDER, ['stale'], 'stale')).toEqual({ index: 5, refId: null });
    expect(blankInsertion([], [], null)).toEqual({ index: 0, refId: null });
  });
});

describe('fitThumbSize', () => {
  it('uses the full width for ordinary portrait and landscape pages', () => {
    expect(fitThumbSize(612, 792, 160, 280)).toEqual({ width: 160, height: 207 });
    expect(fitThumbSize(792, 612, 160, 280)).toEqual({ width: 160, height: 124 });
  });

  it('caps the height for very tall pages', () => {
    const r = fitThumbSize(200, 2000, 160, 280);
    expect(r.height).toBe(280);
    expect(r.width).toBe(28);
  });

  it('falls back to a Letter aspect ratio on bad input', () => {
    expect(fitThumbSize(0, 0, 160, 280)).toEqual({ width: 160, height: 207 });
    expect(fitThumbSize(Number.NaN, 10, 160, 280)).toEqual({ width: 160, height: 207 });
  });
});

describe('formatPageCount', () => {
  it('pluralises', () => {
    expect(formatPageCount(1)).toBe('1 page');
    expect(formatPageCount(0)).toBe('0 pages');
    expect(formatPageCount(12)).toBe('12 pages');
  });
});
