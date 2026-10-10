/**
 * Annotation factories and drag geometry for the editor tools. Pure
 * functions in display space (points, origin bottom-left, y up).
 */
import type {
  Annotation,
  ImageAnnotation,
  InkAnnotation,
  PageGeometry,
  Point,
  RectAnnotation,
  TextAnnotation,
  ToolSettings,
} from '@/core/types';
import { COLORS } from '@/core/types';
import { clamp, rectFromPoints } from '@/core/geometry';
import type { Rect } from '@/core/geometry';
import { newId } from '@/core/ids';
import { translatePoints } from './stroke';

export type RectTool = 'rect' | 'highlight-box' | 'whiteout';
export type InkTool = 'pen' | 'highlighter';

/** Rectangles smaller than this (either side, in points) are ignored. */
export const MIN_RECT_SIZE = 2;
/** Placed signatures are at most this wide (points) ... */
export const SIGNATURE_MAX_WIDTH = 200;
/** ... and at most this fraction of the page width. */
export const SIGNATURE_PAGE_FRACTION = 0.4;

type PageSize = Pick<PageGeometry, 'displayWidth' | 'displayHeight'>;

export function clampPointToPage(p: Point, page: PageSize): Point {
  return { x: clamp(p.x, 0, page.displayWidth), y: clamp(p.y, 0, page.displayHeight) };
}

/**
 * Normalized rectangle for a drag from `a` to `b`, clamped to the page when
 * one is given. Returns null when the result is smaller than MIN_RECT_SIZE.
 */
export function rectFromDrag(a: Point, b: Point, page?: PageSize): Rect | null {
  const r = rectFromPoints(page ? clampPointToPage(a, page) : a, page ? clampPointToPage(b, page) : b);
  if (r.width < MIN_RECT_SIZE || r.height < MIN_RECT_SIZE) return null;
  return r;
}

export function makeRectAnnotation(tool: RectTool, rect: Rect, settings: ToolSettings, id = newId('a')): RectAnnotation {
  const base = { id, type: 'rect' as const, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  switch (tool) {
    case 'rect':
      return {
        ...base,
        fillColor: null,
        strokeColor: settings.color,
        strokeWidth: settings.strokeWidth,
        opacity: 1,
        blendMode: 'Normal',
      };
    case 'highlight-box':
      return {
        ...base,
        fillColor: settings.highlighterColor,
        strokeColor: null,
        strokeWidth: 0,
        opacity: 0.5,
        blendMode: 'Multiply',
      };
    case 'whiteout':
      return { ...base, fillColor: COLORS.white, strokeColor: null, strokeWidth: 0, opacity: 1, blendMode: 'Normal' };
  }
}

export function makeInkAnnotation(tool: InkTool, points: Point[], settings: ToolSettings, id = newId('a')): InkAnnotation {
  const strokes = [points.map((p) => ({ x: p.x, y: p.y }))];
  if (tool === 'highlighter') {
    return {
      id,
      type: 'ink',
      strokes,
      color: settings.highlighterColor,
      strokeWidth: settings.highlighterWidth,
      opacity: 0.5,
      blendMode: 'Multiply',
    };
  }
  return { id, type: 'ink', strokes, color: settings.color, strokeWidth: settings.strokeWidth, opacity: 1, blendMode: 'Normal' };
}

/** A new, empty text annotation whose top-left corner is `at`. */
export function makeTextAnnotation(at: Point, settings: ToolSettings, id = newId('a')): TextAnnotation {
  return {
    id,
    type: 'text',
    x: at.x,
    y: at.y,
    text: '',
    fontSize: settings.fontSize,
    font: settings.font,
    color: settings.textColor,
  };
}

export function makeImageAnnotation(rect: Rect, dataUrl: string, id = newId('a')): ImageAnnotation {
  return { id, type: 'image', x: rect.x, y: rect.y, width: rect.width, height: rect.height, dataUrl };
}

/**
 * Where a signature image lands when the user clicks at `center`: width is
 * min(200pt, 40% of the page width), height follows the image aspect ratio,
 * and the box is shifted to stay on the page.
 */
export function signaturePlacement(center: Point, image: { width: number; height: number }, page: PageSize): Rect {
  const width = Math.max(1, Math.min(SIGNATURE_MAX_WIDTH, page.displayWidth * SIGNATURE_PAGE_FRACTION));
  const aspect = image.width > 0 && image.height > 0 ? image.height / image.width : 0.5;
  const height = Math.max(1, width * aspect);
  const x = clamp(center.x - width / 2, Math.min(0, page.displayWidth - width), Math.max(0, page.displayWidth - width));
  const y = clamp(center.y - height / 2, Math.min(0, page.displayHeight - height), Math.max(0, page.displayHeight - height));
  return { x, y, width, height };
}

/** Patch that moves an annotation by (dx, dy) relative to its *original* position. */
export function translateAnnotation(original: Annotation, dx: number, dy: number): Partial<Annotation> {
  if (original.type === 'ink') {
    return { strokes: original.strokes.map((s) => translatePoints(s, dx, dy)) };
  }
  return { x: original.x + dx, y: original.y + dy };
}

/**
 * Restrict a move so an annotation whose bounds are `bounds` never leaves the
 * page. An annotation that already pokes out may move back in but not further
 * out; one larger than the page may slide between the two edges.
 */
export function clampTranslation(bounds: Rect, dx: number, dy: number, page: PageSize): Point {
  const minX = Math.min(0, bounds.x, page.displayWidth - bounds.width);
  const maxX = Math.max(page.displayWidth - bounds.width, bounds.x, 0);
  const minY = Math.min(0, bounds.y, page.displayHeight - bounds.height);
  const maxY = Math.max(page.displayHeight - bounds.height, bounds.y, 0);
  const nx = clamp(bounds.x + dx, minX, maxX);
  const ny = clamp(bounds.y + dy, minY, maxY);
  return { x: nx - bounds.x, y: ny - bounds.y };
}
