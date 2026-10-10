/**
 * The editor's undo contract exercised against the real store: a drag is one
 * undo step, a stroke is one step, and the text editor's commit plans map to
 * the expected store mutations.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '@/state/store';
import type { PageRef, RectAnnotation, TextAnnotation } from '@/core/types';
import { COLORS, DEFAULT_TOOL_SETTINGS } from '@/core/types';
import { annotationBounds } from '@/components/Editor/hit-test';
import { clampTranslation, makeInkAnnotation, makeRectAnnotation, makeTextAnnotation, translateAnnotation } from '@/components/Editor/tools/shapes';
import { resizeBox } from '@/components/Editor/tools/resize';
import { planTextCommit } from '@/components/Editor/tools/text-edit';

const PAGE = 'p1';
const page = { displayWidth: 612, displayHeight: 792 };

function reset(annotations: PageRef['annotations'] = []) {
  useEditorStore.setState({
    pages: [{ id: PAGE, sourceId: 's', sourceIndex: 0, rotation: 0, annotations }],
    activePageId: PAGE,
    selectedAnnotationId: null,
    tool: 'select',
    past: [],
    future: [],
    dirty: false,
  });
}

function annotations() {
  return useEditorStore.getState().pages[0]!.annotations;
}

const rect: RectAnnotation = makeRectAnnotation('rect', { x: 100, y: 100, width: 50, height: 40 }, DEFAULT_TOOL_SETTINGS, 'r');

/** What useEditorInteractions does for a move: one commitHistory, then transient updates. */
function simulateMove(id: string, steps: { x: number; y: number }[]) {
  const store = useEditorStore.getState();
  const original = annotations().find((a) => a.id === id)!;
  const bounds = annotationBounds(original);
  let patch: ReturnType<typeof translateAnnotation> | null = null;
  let committed = false;
  for (const d of steps) {
    if (!committed) {
      store.commitHistory();
      committed = true;
    }
    const c = clampTranslation(bounds, d.x, d.y, page);
    patch = translateAnnotation(original, c.x, c.y);
    store.updateAnnotation(PAGE, id, patch, false);
  }
  if (patch) store.updateAnnotation(PAGE, id, patch, false); // release
}

describe('move / resize history', () => {
  beforeEach(() => reset([rect]));

  it('a whole drag is exactly one undo step', () => {
    simulateMove('r', [
      { x: 5, y: 5 },
      { x: 20, y: 10 },
      { x: 40, y: 30 },
    ]);
    const s = useEditorStore.getState();
    expect(s.past).toHaveLength(1);
    expect(annotations()[0]).toMatchObject({ x: 140, y: 130 });
    expect(s.dirty).toBe(true);
    s.undo();
    expect(annotations()[0]).toMatchObject({ x: 100, y: 100 });
    expect(useEditorStore.getState().canUndo()).toBe(false);
    useEditorStore.getState().redo();
    expect(annotations()[0]).toMatchObject({ x: 140, y: 130 });
  });

  it('a move that would leave the page is clamped', () => {
    simulateMove('r', [{ x: 1000, y: -1000 }]);
    expect(annotations()[0]).toMatchObject({ x: 612 - 50, y: 0 });
  });

  it('a resize is one undo step too', () => {
    const store = useEditorStore.getState();
    store.commitHistory();
    for (const p of [
      { x: 160, y: 90 },
      { x: 200, y: 50 },
    ]) {
      store.updateAnnotation(PAGE, 'r', resizeBox(annotationBounds(rect), 'se', p, { minSize: 2 }), false);
    }
    expect(annotations()[0]).toMatchObject({ x: 100, y: 50, width: 100, height: 90 });
    expect(useEditorStore.getState().past).toHaveLength(1);
    useEditorStore.getState().undo();
    expect(annotations()[0]).toMatchObject({ x: 100, y: 100, width: 50, height: 40 });
  });

  it('a pen stroke is one undo step', () => {
    const store = useEditorStore.getState();
    store.addAnnotation(PAGE, makeInkAnnotation('pen', [{ x: 1, y: 1 }, { x: 5, y: 5 }], DEFAULT_TOOL_SETTINGS, 'ink'));
    expect(annotations()).toHaveLength(2);
    expect(useEditorStore.getState().past).toHaveLength(1);
    useEditorStore.getState().undo();
    expect(annotations()).toHaveLength(1);
  });
});

describe('text commit plans against the store', () => {
  beforeEach(() => reset());

  function commit(session: { annotation: TextAnnotation; isNew: boolean; text: string }) {
    const store = useEditorStore.getState();
    const plan = planTextCommit(session.isNew, session.annotation.text, session.text);
    switch (plan) {
      case 'add':
        store.addAnnotation(PAGE, { ...session.annotation, text: session.text });
        break;
      case 'update':
        store.updateAnnotation(PAGE, session.annotation.id, { text: session.text }, true);
        break;
      case 'remove':
        store.removeAnnotation(PAGE, session.annotation.id);
        break;
      case 'none':
        break;
    }
    return plan;
  }

  it('a new annotation is added once (one undo step) and an empty one never touches the store', () => {
    const draft = makeTextAnnotation({ x: 10, y: 700 }, DEFAULT_TOOL_SETTINGS, 't');
    expect(commit({ annotation: draft, isNew: true, text: '   ' })).toBe('none');
    expect(annotations()).toHaveLength(0);
    expect(useEditorStore.getState().past).toHaveLength(0);

    expect(commit({ annotation: draft, isNew: true, text: 'Hello' })).toBe('add');
    expect(annotations()[0]).toMatchObject({ type: 'text', text: 'Hello', x: 10, y: 700, color: COLORS.black });
    expect(useEditorStore.getState().past).toHaveLength(1);
  });

  it('editing an existing annotation records one step; clearing it removes it', () => {
    const existing: TextAnnotation = { ...makeTextAnnotation({ x: 1, y: 2 }, DEFAULT_TOOL_SETTINGS, 't'), text: 'old' };
    reset([existing]);
    expect(commit({ annotation: existing, isNew: false, text: 'old' })).toBe('none');
    expect(useEditorStore.getState().past).toHaveLength(0);
    expect(commit({ annotation: existing, isNew: false, text: 'new' })).toBe('update');
    expect(annotations()[0]).toMatchObject({ text: 'new' });
    expect(useEditorStore.getState().past).toHaveLength(1);
    expect(commit({ annotation: existing, isNew: false, text: '' })).toBe('remove');
    expect(annotations()).toHaveLength(0);
    useEditorStore.getState().undo();
    expect(annotations()[0]).toMatchObject({ text: 'new' });
  });
});
