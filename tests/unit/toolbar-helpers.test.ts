import { describe, expect, it } from 'vitest';
import { targetPageIds, targetPageWord } from '@/components/Toolbar/helpers';
import type { PageTargetState } from '@/components/Toolbar/helpers';
import { blankInsertion } from '@/components/PageGrid/helpers';

const ORDER = ['p1', 'p2', 'p3', 'p4'];

function state(partial: Partial<PageTargetState>): PageTargetState {
  return { viewMode: 'editor', selectedPageIds: [], activePageId: 'p2', ...partial };
}

describe('targetPageIds', () => {
  it('falls back to the active page when nothing is selected, in either view', () => {
    expect(targetPageIds(state({ viewMode: 'editor' }))).toEqual(['p2']);
    expect(targetPageIds(state({ viewMode: 'grid' }))).toEqual(['p2']);
  });

  it('returns nothing without an active page or selection', () => {
    expect(targetPageIds(state({ activePageId: null }))).toEqual([]);
  });

  it('uses the selection in grid view', () => {
    expect(targetPageIds(state({ viewMode: 'grid', selectedPageIds: ['p3', 'p1'] }))).toEqual(['p3', 'p1']);
  });

  it('uses the sidebar selection in editor view too (the sidebar header acts on it as well)', () => {
    // Shift-click range in the sidebar: three pages selected, page 1 active.
    const s = state({ viewMode: 'editor', selectedPageIds: ['p1', 'p2', 'p3'], activePageId: 'p1' });
    expect(targetPageIds(s)).toEqual(['p1', 'p2', 'p3']);
    // A single selected page that is not the one being edited still wins.
    expect(targetPageIds(state({ viewMode: 'editor', selectedPageIds: ['p4'], activePageId: 'p1' }))).toEqual(['p4']);
  });
});

describe('targetPageWord', () => {
  it('names what the page buttons will act on', () => {
    expect(targetPageWord(state({}))).toBe('current page');
    expect(targetPageWord(state({ activePageId: null }))).toBe('current page');
    expect(targetPageWord(state({ selectedPageIds: ['p2'] }))).toBe('current page');
    expect(targetPageWord(state({ selectedPageIds: ['p4'] }))).toBe('selected page');
    expect(targetPageWord(state({ selectedPageIds: ['p1', 'p2', 'p3'] }))).toBe('selected pages');
    expect(targetPageWord(state({ viewMode: 'grid', selectedPageIds: ['p3', 'p1'] }))).toBe('selected pages');
  });
});

describe('toolbar "Insert blank page" anchor', () => {
  /** What Toolbar.insertBlank computes. */
  const toolbar = (s: PageTargetState) => blankInsertion(ORDER, targetPageIds(s), s.activePageId);
  /** What the grid header's button computes. */
  const gridHeader = (s: PageTargetState) => blankInsertion(ORDER, s.selectedPageIds, s.activePageId);

  it('inserts after the current page when nothing is selected', () => {
    expect(toolbar(state({ activePageId: 'p2' }))).toEqual({ index: 2, refId: 'p2' });
    expect(toolbar(state({ activePageId: 'p4' }))).toEqual({ index: 4, refId: 'p4' });
  });

  it('appends a Letter page when there is no target at all', () => {
    expect(toolbar(state({ activePageId: null }))).toEqual({ index: ORDER.length, refId: null });
  });

  it('uses the last selected page in document order, not click order, and agrees with the grid header', () => {
    // page 3 clicked, then ctrl-click page 1: selection is in click order
    const s = state({ viewMode: 'grid', selectedPageIds: ['p3', 'p1'], activePageId: 'p1' });
    expect(toolbar(s)).toEqual({ index: 3, refId: 'p3' });
    expect(toolbar(s)).toEqual(gridHeader(s));
  });

  it('ignores selected ids that no longer exist', () => {
    const s = state({ selectedPageIds: ['gone', 'p2'], activePageId: 'p1' });
    expect(toolbar(s)).toEqual({ index: 2, refId: 'p2' });
  });
});
