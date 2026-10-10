/** Which CSS cursor the overlay shows for the current tool / hover / drag. Pure. */
import type { AnnotationId, Tool } from '@/core/types';
import { cursorForCorner } from './resize';
import type { Corner } from './resize';

export type EditorCursor =
  | 'default'
  | 'pointer'
  | 'move'
  | 'text'
  | 'crosshair'
  | 'copy'
  | 'nwse-resize'
  | 'nesw-resize';

export type ActiveInteraction = 'ink' | 'rect' | 'move' | 'resize' | 'click' | 'consumed';

export interface HoverState {
  id: AnnotationId | null;
  corner: Corner | null;
}

export const NO_HOVER: HoverState = { id: null, corner: null };

export function cursorFor(
  tool: Tool,
  active: ActiveInteraction | null,
  activeCorner: Corner | null,
  hover: HoverState,
  selectedId: AnnotationId | null,
): EditorCursor {
  if (active === 'ink' || active === 'rect') return 'crosshair';
  if (active === 'move') return 'move';
  if (active === 'resize') return activeCorner ? cursorForCorner(activeCorner) : 'nwse-resize';
  switch (tool) {
    case 'text':
      return 'text';
    case 'signature':
      return 'copy';
    case 'pen':
    case 'highlighter':
    case 'rect':
    case 'highlight-box':
    case 'whiteout':
      return 'crosshair';
    case 'select':
      if (hover.corner) return cursorForCorner(hover.corner);
      if (hover.id) return hover.id === selectedId ? 'move' : 'pointer';
      return 'default';
  }
}
