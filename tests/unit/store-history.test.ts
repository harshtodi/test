/**
 * Undo/redo semantics of the document store around imports, deleting every
 * page and the active page after a history step.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '@/state/store';
import { createBlankPageSource, importFile } from '@/core/import';
import { makePdf } from '../helpers/make-pdf';

const S = () => useEditorStore.getState();
const reset = () => useEditorStore.setState(useEditorStore.getInitialState(), true);

async function load(name: string, count: number) {
  const pages = Array.from({ length: count }, (_, i) => ({ label: `${name} ${i + 1}` }));
  const source = await importFile(name, await makePdf(pages));
  return S().addSource(source);
}

beforeEach(reset);

describe('import history', () => {
  it('the very first import is not undoable', async () => {
    await load('a.pdf', 2);
    expect(S().past).toEqual([]);
    expect(S().canUndo()).toBe(false);
    expect(S().dirty).toBe(true);
  });

  it('a second import into a non-empty document is one undo step', async () => {
    await load('a.pdf', 2);
    await load('b.pdf', 1);
    expect(S().past).toHaveLength(1);
    S().undo();
    expect(S().pages).toHaveLength(2);
  });

  it('importing after every page was deleted keeps the deletion undoable', async () => {
    const a = await load('a.pdf', 3);
    S().removePages(a);
    expect(S().pages).toHaveLength(0);
    expect(S().past).toHaveLength(1);

    const b = await load('b.pdf', 2);
    expect(S().past).toHaveLength(2);
    expect(S().pages.map((p) => p.id)).toEqual(b);

    S().undo();
    expect(S().pages).toHaveLength(0);
    S().undo();
    expect(S().pages.map((p) => p.id)).toEqual(a);

    S().redo();
    S().redo();
    expect(S().pages.map((p) => p.id)).toEqual(b);
  });
});

describe('deleting every page', () => {
  it('clears the unsaved flag (undo sets it again)', async () => {
    const ids = await load('a.pdf', 2);
    S().removePages([ids[0]!]);
    expect(S().dirty).toBe(true);
    S().removePages([ids[1]!]);
    expect(S().pages).toHaveLength(0);
    expect(S().dirty).toBe(false);
    expect(S().canUndo()).toBe(true);
    S().undo();
    expect(S().pages).toHaveLength(1);
    expect(S().dirty).toBe(true);
  });

  it('lets the next import name the output again', async () => {
    const a = await load('alpha.pdf', 1);
    expect(S().outputName).toBe('alpha-edited.pdf');
    await load('other.pdf', 1);
    expect(S().outputName).toBe('alpha-edited.pdf');
    S().removePages(S().pages.map((p) => p.id));
    expect(S().outputName).toBe('alpha-edited.pdf');
    await load('bravo.pdf', 1);
    expect(S().outputName).toBe('bravo-edited.pdf');
    expect(a).toHaveLength(1);
  });
});

describe('active page after undo/redo', () => {
  it('undoing an insert in the middle stays where the user was', async () => {
    const ids = await load('a.pdf', 10);
    S().setActivePage(ids[6]!);
    const blank = await createBlankPageSource(612, 792);
    const [blankId] = S().addSource(blank, 7);
    S().setActivePage(blankId!);
    S().undo();
    expect([ids[6], ids[7]]).toContain(S().activePageId);
  });

  it('redoing the deletion of the active page moves to its neighbour', async () => {
    const ids = await load('a.pdf', 5);
    S().setActivePage(ids[2]!);
    S().removePages([ids[2]!]);
    expect(S().activePageId).toBe(ids[3]);
    S().undo();
    S().setActivePage(ids[2]!);
    S().redo();
    expect(S().activePageId).toBe(ids[3]);
  });

  it('keeps the active page when it still exists and clears it when nothing is left', async () => {
    const ids = await load('a.pdf', 3);
    S().setActivePage(ids[1]!);
    S().rotatePages([ids[0]!], 90);
    S().undo();
    expect(S().activePageId).toBe(ids[1]);
    S().removePages(ids);
    expect(S().activePageId).toBeNull();
    S().undo();
    expect(S().activePageId).toBe(ids[0]); // nothing was active: start at the first page
    S().redo();
    expect(S().activePageId).toBeNull();
  });
});
