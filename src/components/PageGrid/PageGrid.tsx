/**
 * Page grid / thumbnail sidebar (milestone M2).
 *
 * - `variant="list"`: narrow vertical strip next to the editor.
 * - `variant="grid"`: full-pane CSS grid for arranging the document.
 *
 * Reordering uses dnd-kit (pointer + keyboard sensors); selection, rotation,
 * duplication, deletion and blank-page insertion go straight to the Zustand
 * store. Pure index/selection math lives in ./helpers.ts.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useEditorStore } from '@/state/store';
import type { PageId } from '@/core/types';
import { PAGE_SIZES } from '@/core/types';
import { getPageGeometry } from '@/core/geometry';
import { createBlankPageSource } from '@/core/import';
import { blankInsertion, formatPageCount, nextIndexForKey, planMove, rangeSelect, unionIds } from './helpers';
import { PageThumbnail, ThumbPreview } from './PageThumbnail';
import { BlankPageIcon, DuplicateIcon, RotateCcwIcon, RotateCwIcon, SelectAllIcon, TrashIcon } from './icons';
import './PageGrid.css';

export type PageGridVariant = 'list' | 'grid';

export const THUMB_WIDTH: Record<PageGridVariant, number> = { list: 160, grid: 180 };

const EMPTY_SELECTION: PageId[] = [];

function findThumb(root: HTMLElement | null, id: PageId): HTMLElement | null {
  if (!root) return null;
  const esc = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id;
  return root.querySelector<HTMLElement>(`[data-testid="page-thumb"][data-page-id="${esc}"]`);
}

/** Number of tiles in the first row of the grid (1 in the list variant). */
export function getColumnCount(list: HTMLElement | null): number {
  if (!list) return 1;
  const items = list.querySelectorAll<HTMLElement>('[data-testid="page-thumb"]');
  if (items.length < 2) return 1;
  const firstTop = items[0]!.offsetTop;
  let cols = 1;
  for (let i = 1; i < items.length; i++) {
    if (items[i]!.offsetTop !== firstTop) break;
    cols++;
  }
  return cols;
}

export function PageGrid({ variant }: { variant: PageGridVariant }) {
  const pages = useEditorStore((s) => s.pages);
  const sources = useEditorStore((s) => s.sources);
  const selectedPageIds = useEditorStore((s) => s.selectedPageIds);
  const activePageId = useEditorStore((s) => s.activePageId);

  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Anchor for shift+click / shift+arrow range selection. */
  const anchorRef = useRef<PageId | null>(null);
  /** True from drag start until just after drop; suppresses the click that may follow a drag. */
  const draggingRef = useRef(false);
  const [activeDragId, setActiveDragId] = useState<PageId | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  const thumbWidth = THUMB_WIDTH[variant];
  const order = useMemo(() => pages.map((p) => p.id), [pages]);
  const selectedSet = useMemo(() => new Set(selectedPageIds), [selectedPageIds]);
  const selectedCount = selectedPageIds.filter((id) => order.includes(id)).length;
  const hasSelection = selectedCount > 0;
  const allSelected = pages.length > 0 && selectedCount === pages.length;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Space picks a page up / drops it; Enter alone opens the page in the editor.
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  // Sticky header height → scroll-margin so scrollIntoView never hides a tile under it.
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [variant]);

  // Keep the active page visible when it changes (editor navigation, shortcuts, arrows).
  useEffect(() => {
    if (!activePageId) return;
    const el = findThumb(listRef.current, activePageId);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activePageId, variant]);

  // ----- drag & drop -----

  const finishDrag = useCallback(() => {
    setActiveDragId(null);
    window.setTimeout(() => {
      draggingRef.current = false;
    }, 0);
  }, []);

  const onDragStart = useCallback((e: DragStartEvent) => {
    draggingRef.current = true;
    setActiveDragId(String(e.active.id));
  }, []);

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      finishDrag();
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const s = useEditorStore.getState();
      const ids = s.pages.map((p) => p.id);
      const plan = planMove(ids, s.selectedPageIds, String(active.id), String(over.id));
      if (!plan) return;
      if (plan.kind === 'single') s.movePage(plan.fromIndex, plan.toIndex);
      else s.movePages(plan.ids, plan.toIndex);
    },
    [finishDrag],
  );

  // ----- selection -----

  const handleThumbClick = useCallback((id: PageId, e: ReactMouseEvent<HTMLElement>) => {
    if (draggingRef.current) return;
    const s = useEditorStore.getState();
    const additive = e.ctrlKey || e.metaKey;
    if (e.shiftKey) {
      const ids = s.pages.map((p) => p.id);
      const range = rangeSelect(ids, anchorRef.current ?? s.activePageId, id);
      s.selectPages(additive ? unionIds(s.selectedPageIds, range) : range);
    } else {
      s.togglePageSelection(id, additive);
      anchorRef.current = id;
    }
    s.setActivePage(id);
  }, []);

  const handleThumbDoubleClick = useCallback((id: PageId) => {
    if (draggingRef.current) return;
    const s = useEditorStore.getState();
    s.setActivePage(id);
    s.setViewMode('editor');
  }, []);

  const handleRotate = useCallback((id: PageId, delta: 90 | -90) => {
    useEditorStore.getState().rotatePages([id], delta);
  }, []);
  const handleDuplicate = useCallback((id: PageId) => {
    useEditorStore.getState().duplicatePages([id]);
  }, []);
  const handleDelete = useCallback((id: PageId) => {
    useEditorStore.getState().removePages([id]);
  }, []);

  const toggleSelectAll = () => {
    const s = useEditorStore.getState();
    const ids = s.pages.map((p) => p.id);
    const everything = ids.length > 0 && ids.every((id) => s.selectedPageIds.includes(id));
    s.selectPages(everything ? EMPTY_SELECTION : ids);
  };

  const rotateSelected = (delta: 90 | -90) => {
    const s = useEditorStore.getState();
    s.rotatePages(s.selectedPageIds, delta);
  };
  const duplicateSelected = () => {
    const s = useEditorStore.getState();
    s.duplicatePages(s.selectedPageIds);
  };
  const deleteSelected = () => {
    const s = useEditorStore.getState();
    s.removePages(s.selectedPageIds);
  };

  const insertBlank = async () => {
    const s = useEditorStore.getState();
    const ids = s.pages.map((p) => p.id);
    const { index, refId } = blankInsertion(ids, s.selectedPageIds, s.activePageId);
    let size: { width: number; height: number } = PAGE_SIZES.Letter;
    const ref = refId ? s.pages.find((p) => p.id === refId) : undefined;
    const refSource = ref ? s.sources[ref.sourceId] : undefined;
    if (ref && refSource) {
      try {
        const g = getPageGeometry(ref, refSource);
        size = { width: g.displayWidth, height: g.displayHeight };
      } catch {
        /* keep Letter */
      }
    }
    try {
      const source = await createBlankPageSource(size.width, size.height);
      const newIds = useEditorStore.getState().addSource(source, index);
      const after = useEditorStore.getState();
      after.selectPages(newIds);
      const first = newIds[0];
      if (first) {
        after.setActivePage(first);
        anchorRef.current = first;
      }
    } catch (err) {
      useEditorStore.getState().notify('error', `Could not insert a blank page: ${(err as Error).message}`);
    }
  };

  // ----- keyboard navigation -----

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (draggingRef.current || e.defaultPrevented) return;
    const s = useEditorStore.getState();
    const ids = s.pages.map((p) => p.id);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      s.selectPages(ids);
      return;
    }
    if (e.key === 'Enter') {
      if (s.activePageId) {
        e.preventDefault();
        s.setViewMode('editor');
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const current = s.activePageId ? ids.indexOf(s.activePageId) : -1;
    const columns = variant === 'grid' ? getColumnCount(listRef.current) : 1;
    const next = nextIndexForKey(e.key, current, ids.length, columns);
    if (next === null) return;
    e.preventDefault();
    const id = ids[next];
    if (!id) return;
    if (e.shiftKey) {
      s.selectPages(rangeSelect(ids, anchorRef.current ?? s.activePageId, id));
    } else {
      s.selectPages([id]);
      anchorRef.current = id;
    }
    s.setActivePage(id);
    findThumb(listRef.current, id)?.focus({ preventScroll: true });
  };

  const onBackgroundClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    useEditorStore.getState().selectPages(EMPTY_SELECTION);
  };

  // ----- render -----

  const dragPage = activeDragId ? pages.find((p) => p.id === activeDragId) : undefined;
  const dragIndex = dragPage ? order.indexOf(dragPage.id) : -1;
  const dragCount = dragPage && selectedSet.has(dragPage.id) ? Math.max(1, selectedCount) : 1;
  const rootStyle = { '--pg-header-h': `${headerHeight}px` } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={`page-grid page-grid-${variant}`}
      data-testid="page-grid"
      data-variant={variant}
      style={rootStyle}
    >
      <div ref={headerRef} className="page-grid-header" data-testid="page-grid-header">
        <div className="page-grid-status">
          <span className="page-grid-count" data-testid="page-count">
            {formatPageCount(pages.length)}
          </span>
          {hasSelection && (
            <span className="page-grid-selected" data-testid="selected-count">
              {selectedCount} selected
            </span>
          )}
        </div>
        <div className="page-grid-actions" role="toolbar" aria-label="Page actions">
          <button
            type="button"
            className="btn pg-btn"
            data-testid="grid-select-all"
            aria-label={allSelected ? 'Deselect all pages' : 'Select all pages'}
            aria-pressed={allSelected}
            title={allSelected ? 'Deselect all' : 'Select all'}
            disabled={pages.length === 0}
            onClick={toggleSelectAll}
          >
            <SelectAllIcon />
            <span className="pg-btn-label">{allSelected ? 'Deselect all' : 'Select all'}</span>
          </button>
          <button
            type="button"
            className="btn pg-btn"
            data-testid="grid-rotate-ccw"
            aria-label="Rotate selected pages left"
            title="Rotate selected left"
            disabled={!hasSelection}
            onClick={() => rotateSelected(-90)}
          >
            <RotateCcwIcon />
            <span className="pg-btn-label">Rotate left</span>
          </button>
          <button
            type="button"
            className="btn pg-btn"
            data-testid="grid-rotate-cw"
            aria-label="Rotate selected pages right"
            title="Rotate selected right"
            disabled={!hasSelection}
            onClick={() => rotateSelected(90)}
          >
            <RotateCwIcon />
            <span className="pg-btn-label">Rotate right</span>
          </button>
          <button
            type="button"
            className="btn pg-btn"
            data-testid="grid-duplicate"
            aria-label="Duplicate selected pages"
            title="Duplicate selected"
            disabled={!hasSelection}
            onClick={duplicateSelected}
          >
            <DuplicateIcon />
            <span className="pg-btn-label">Duplicate</span>
          </button>
          <button
            type="button"
            className="btn pg-btn pg-btn-danger"
            data-testid="grid-delete"
            aria-label="Delete selected pages"
            title="Delete selected"
            disabled={!hasSelection}
            onClick={deleteSelected}
          >
            <TrashIcon />
            <span className="pg-btn-label">Delete</span>
          </button>
          <button
            type="button"
            className="btn pg-btn"
            data-testid="grid-insert-blank"
            aria-label="Insert blank page"
            title="Insert blank page after the selection (or at the end)"
            onClick={() => void insertBlank()}
          >
            <BlankPageIcon />
            <span className="pg-btn-label">Insert blank page</span>
          </button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={finishDrag}
      >
        <SortableContext items={order} strategy={variant === 'grid' ? rectSortingStrategy : verticalListSortingStrategy}>
          <div
            ref={listRef}
            className="page-grid-items"
            data-testid="page-grid-items"
            role="listbox"
            aria-label="Pages"
            aria-multiselectable="true"
            onKeyDown={onKeyDown}
            onClick={onBackgroundClick}
          >
            {pages.map((page, index) => (
              <PageThumbnail
                key={page.id}
                page={page}
                source={sources[page.sourceId]}
                index={index}
                thumbWidth={thumbWidth}
                selected={selectedSet.has(page.id)}
                active={page.id === activePageId}
                onClick={handleThumbClick}
                onDoubleClick={handleThumbDoubleClick}
                onRotate={handleRotate}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </SortableContext>
        {typeof document !== 'undefined' &&
          createPortal(
            <DragOverlay dropAnimation={null} zIndex={1200}>
              {dragPage ? (
                <ThumbPreview
                  page={dragPage}
                  source={sources[dragPage.sourceId]}
                  index={dragIndex}
                  thumbWidth={thumbWidth}
                  count={dragCount}
                />
              ) : null}
            </DragOverlay>,
            document.body,
          )}
      </DndContext>
    </div>
  );
}
