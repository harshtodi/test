/**
 * Core data model shared by the renderer UI, the export engine and tests.
 *
 * COORDINATE SYSTEM (read this before touching annotations)
 * ---------------------------------------------------------
 * Every annotation is stored in **display space** of the page it belongs to:
 *   - units are PDF points (1/72 inch),
 *   - the origin is the bottom-left corner of the page *as displayed*, i.e.
 *     after the page's total rotation (source /Rotate + user rotation),
 *   - x grows to the right, y grows upward,
 *   - the page's display size is `PageGeometry.displayWidth/displayHeight`.
 *
 * The editor converts pointer positions (canvas pixels, y down) to display
 * space with `src/core/geometry.ts`. The exporter maps display space back to
 * the PDF user space with a single transformation matrix per page, so text and
 * images always come out upright for the viewer regardless of page rotation.
 */

export type SourceId = string;
export type PageId = string;
export type AnnotationId = string;

/** A rotation in degrees, clockwise, as used by the PDF /Rotate entry. */
export type Rotation = 0 | 90 | 180 | 270;

/**
 * An imported document. Images dropped into the app are converted to a
 * one-page PDF on import so every source is a PDF.
 */
export interface SourceDoc {
  id: SourceId;
  /** Original file name, used for the suggested output name. */
  name: string;
  /** Raw PDF bytes. Treated as immutable once stored. */
  bytes: Uint8Array;
  pageCount: number;
  /** Unrotated media/crop box size and base rotation for every source page. */
  pages: SourcePageInfo[];
}

export interface SourcePageInfo {
  /** Width of the visible box (CropBox ∩ MediaBox) in points, before rotation. */
  width: number;
  /** Height of the visible box in points, before rotation. */
  height: number;
  /** The page's own /Rotate value, normalized to 0/90/180/270. */
  rotation: Rotation;
}

/** One page in the working document. The same source page may appear twice. */
export interface PageRef {
  id: PageId;
  sourceId: SourceId;
  /** 0-based page index inside the source document. */
  sourceIndex: number;
  /** Extra rotation applied by the user, on top of the source page rotation. */
  rotation: Rotation;
  annotations: Annotation[];
}

export interface RGB {
  /** 0..1 */
  r: number;
  g: number;
  b: number;
}

export type BlendMode = 'Normal' | 'Multiply';

export type StandardFontName = 'Helvetica' | 'Helvetica-Bold' | 'TimesRoman' | 'Courier';

interface AnnotationBase {
  id: AnnotationId;
  type: 'text' | 'ink' | 'rect' | 'image';
}

/** Free text. `x`,`y` is the TOP-LEFT corner of the text block (display space). */
export interface TextAnnotation extends AnnotationBase {
  type: 'text';
  x: number;
  y: number;
  text: string;
  fontSize: number;
  font: StandardFontName;
  color: RGB;
}

/**
 * Freehand strokes (pen, highlighter). Each stroke is a polyline in display
 * space. Highlighter = ink with `opacity` < 1 and `blendMode: 'Multiply'`.
 */
export interface InkAnnotation extends AnnotationBase {
  type: 'ink';
  strokes: Point[][];
  color: RGB;
  strokeWidth: number;
  /** 0..1 */
  opacity: number;
  blendMode: BlendMode;
}

/**
 * Axis-aligned rectangle. `x`,`y` is the BOTTOM-LEFT corner (display space).
 * Whiteout = white fill, no stroke. Highlight box = yellow fill, opacity 0.5,
 * blend mode Multiply.
 */
export interface RectAnnotation extends AnnotationBase {
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  fillColor: RGB | null;
  strokeColor: RGB | null;
  strokeWidth: number;
  /** 0..1 */
  opacity: number;
  blendMode: BlendMode;
}

/**
 * A raster image (signatures, stamps). `x`,`y` is the BOTTOM-LEFT corner
 * (display space). `dataUrl` is a PNG or JPEG data URL.
 */
export interface ImageAnnotation extends AnnotationBase {
  type: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
}

export type Annotation = TextAnnotation | InkAnnotation | RectAnnotation | ImageAnnotation;

export interface Point {
  x: number;
  y: number;
}

/** Everything a renderer needs to lay out one page. */
export interface PageGeometry {
  /** Source page width before rotation (points). */
  width: number;
  /** Source page height before rotation (points). */
  height: number;
  /** Source /Rotate + user rotation, normalized. */
  totalRotation: Rotation;
  /** Size of the page as displayed (swapped when totalRotation is 90/270). */
  displayWidth: number;
  displayHeight: number;
}

export const PAGE_SIZES = {
  Letter: { width: 612, height: 792 },
  A4: { width: 595.28, height: 841.89 },
  Legal: { width: 612, height: 1008 },
} as const;

export type PageSizeName = keyof typeof PAGE_SIZES;

/** Tools available in the page editor. */
export type Tool =
  | 'select'
  | 'text'
  | 'pen'
  | 'highlighter'
  | 'rect'
  | 'highlight-box'
  | 'whiteout'
  | 'signature';

export interface ToolSettings {
  /** Pen / rectangle stroke color. */
  color: RGB;
  /** Pen stroke width (points). */
  strokeWidth: number;
  /** Highlighter stroke width (points). */
  highlighterWidth: number;
  highlighterColor: RGB;
  fontSize: number;
  font: StandardFontName;
  textColor: RGB;
}

export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  color: { r: 0.85, g: 0.1, b: 0.1 },
  strokeWidth: 2,
  highlighterWidth: 14,
  highlighterColor: { r: 1, g: 0.92, b: 0.23 },
  fontSize: 14,
  font: 'Helvetica',
  textColor: { r: 0, g: 0, b: 0 },
};

export const COLORS = {
  black: { r: 0, g: 0, b: 0 } as RGB,
  white: { r: 1, g: 1, b: 1 } as RGB,
  red: { r: 0.85, g: 0.1, b: 0.1 } as RGB,
  blue: { r: 0.12, g: 0.35, b: 0.9 } as RGB,
  green: { r: 0.1, g: 0.6, b: 0.25 } as RGB,
  yellow: { r: 1, g: 0.92, b: 0.23 } as RGB,
};
