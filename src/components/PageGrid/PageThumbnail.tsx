/**
 * One page in the grid: a sortable (dnd-kit) tile with a lazily rendered
 * thumbnail, page-number badge and hover actions. Memoised: PageGrid passes
 * stable callbacks and primitive flags so selection changes only re-render the
 * tiles that changed.
 */
import { memo, useCallback, useRef } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, SyntheticEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PageGeometry, PageId, PageRef, SourceDoc } from '@/core/types';
import { PAGE_SIZES } from '@/core/types';
import { getPageGeometry } from '@/core/geometry';
import { fitThumbSize } from './helpers';
import { useInView, useThumbnail } from './useThumbnail';
import { DuplicateIcon, RotateCcwIcon, RotateCwIcon, TrashIcon } from './icons';

/** Tall pages are capped at this many times the thumbnail width. */
export const THUMB_MAX_ASPECT = 1.75;

export function safeGeometry(page: PageRef, source: SourceDoc | undefined): PageGeometry {
  if (source) {
    try {
      return getPageGeometry(page, source);
    } catch {
      /* fall through to a Letter-sized placeholder */
    }
  }
  const { width, height } = PAGE_SIZES.Letter;
  return { width, height, totalRotation: page.rotation, displayWidth: width, displayHeight: height };
}

export function thumbBox(page: PageRef, source: SourceDoc | undefined, thumbWidth: number) {
  const g = safeGeometry(page, source);
  return fitThumbSize(g.displayWidth, g.displayHeight, thumbWidth, Math.round(thumbWidth * THUMB_MAX_ASPECT));
}

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

function stop(e: SyntheticEvent): void {
  e.stopPropagation();
}

/** Keep Space/Enter on an action button from starting a drag or opening the editor. */
function stopActivationKeys(e: ReactKeyboardEvent): void {
  if (e.key === ' ' || e.key === 'Enter') e.stopPropagation();
}

export interface PageThumbnailProps {
  page: PageRef;
  source: SourceDoc | undefined;
  /** 0-based position in the document. */
  index: number;
  thumbWidth: number;
  selected: boolean;
  active: boolean;
  onClick: (id: PageId, e: ReactMouseEvent<HTMLElement>) => void;
  onDoubleClick: (id: PageId) => void;
  onRotate: (id: PageId, delta: 90 | -90) => void;
  onDuplicate: (id: PageId) => void;
  onDelete: (id: PageId) => void;
}

export const PageThumbnail = memo(function PageThumbnail({
  page,
  source,
  index,
  thumbWidth,
  selected,
  active,
  onClick,
  onDoubleClick,
  onRotate,
  onDuplicate,
  onDelete,
}: PageThumbnailProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
    attributes: { role: 'option', roleDescription: 'page' },
  });

  const frameRef = useRef<HTMLDivElement>(null);
  const inView = useInView(frameRef);
  const { width, height } = thumbBox(page, source, thumbWidth);
  const { src, error } = useThumbnail(page, source, width, inView);

  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      setNodeRef(el);
      setActivatorNodeRef(el);
    },
    [setNodeRef, setActivatorNodeRef],
  );

  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  const pageNumber = index + 1;
  const sourceName = source?.name ?? 'Unknown source';
  const title = `${sourceName} · page ${page.sourceIndex + 1}`;

  return (
    <div
      ref={setRefs}
      className={cx('page-thumb', selected && 'selected', active && 'active', isDragging && 'dragging')}
      style={style}
      data-testid="page-thumb"
      data-page-index={index}
      data-page-id={page.id}
      data-selected={selected ? 'true' : 'false'}
      data-active={active ? 'true' : 'false'}
      title={title}
      {...attributes}
      {...listeners}
      role="option"
      aria-selected={selected}
      aria-pressed={undefined}
      aria-label={`Page ${pageNumber}, ${title}`}
      tabIndex={active ? 0 : -1}
      onClick={(e) => onClick(page.id, e)}
      onDoubleClick={() => onDoubleClick(page.id)}
    >
      <div ref={frameRef} className="page-thumb-frame" style={{ width, height }}>
        {src ? (
          <img
            className="page-thumb-image"
            data-testid="page-thumb-image"
            src={src}
            alt=""
            width={width}
            height={height}
            draggable={false}
            decoding="async"
          />
        ) : (
          <div
            className={cx('page-thumb-placeholder', error && 'error')}
            data-testid="page-thumb-placeholder"
            aria-hidden="true"
          />
        )}
        <span className="page-thumb-badge" data-testid="page-thumb-badge" aria-hidden="true">
          {pageNumber}
        </span>
        <div
          className="page-thumb-actions"
          role="toolbar"
          aria-label={`Page ${pageNumber} actions`}
          onPointerDown={stop}
          onMouseDown={stop}
          onClick={stop}
          onDoubleClick={stop}
          onKeyDown={stopActivationKeys}
        >
          <button
            type="button"
            className="btn btn-icon page-thumb-action"
            data-testid="thumb-rotate-ccw"
            aria-label={`Rotate page ${pageNumber} left`}
            title="Rotate left"
            tabIndex={-1}
            onClick={() => onRotate(page.id, -90)}
          >
            <RotateCcwIcon />
          </button>
          <button
            type="button"
            className="btn btn-icon page-thumb-action"
            data-testid="thumb-rotate-cw"
            aria-label={`Rotate page ${pageNumber} right`}
            title="Rotate right"
            tabIndex={-1}
            onClick={() => onRotate(page.id, 90)}
          >
            <RotateCwIcon />
          </button>
          <button
            type="button"
            className="btn btn-icon page-thumb-action"
            data-testid="thumb-duplicate"
            aria-label={`Duplicate page ${pageNumber}`}
            title="Duplicate"
            tabIndex={-1}
            onClick={() => onDuplicate(page.id)}
          >
            <DuplicateIcon />
          </button>
          <button
            type="button"
            className="btn btn-icon page-thumb-action page-thumb-action-danger"
            data-testid="thumb-delete"
            aria-label={`Delete page ${pageNumber}`}
            title="Delete"
            tabIndex={-1}
            onClick={() => onDelete(page.id)}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    </div>
  );
});

/** Static preview used inside the DragOverlay. */
export function ThumbPreview({
  page,
  source,
  index,
  thumbWidth,
  count,
}: {
  page: PageRef;
  source: SourceDoc | undefined;
  index: number;
  thumbWidth: number;
  /** Number of pages moving together. */
  count: number;
}) {
  const { width, height } = thumbBox(page, source, thumbWidth);
  const { src } = useThumbnail(page, source, width, true);
  return (
    <div className="page-thumb page-thumb-preview" data-testid="page-drag-overlay" data-page-id={page.id}>
      <div className="page-thumb-frame" style={{ width, height }}>
        {src ? (
          <img className="page-thumb-image" src={src} alt="" width={width} height={height} draggable={false} />
        ) : (
          <div className="page-thumb-placeholder" aria-hidden="true" />
        )}
        <span className="page-thumb-badge" aria-hidden="true">
          {index + 1}
        </span>
        {count > 1 && (
          <span className="page-thumb-count" data-testid="page-drag-count">
            {count} pages
          </span>
        )}
      </div>
    </div>
  );
}
