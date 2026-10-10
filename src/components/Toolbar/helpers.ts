/**
 * Pure helpers for the toolbar: palettes, option lists, output-name
 * normalisation and the mapping from a selected annotation to the style
 * options that can edit it. No React, no DOM.
 */
import type { Annotation, PageId, RGB, StandardFontName, Tool } from '@/core/types';
import { COLORS } from '@/core/types';

export interface Swatch {
  /** Used in the `opt-color-<name>` test id and the tooltip. */
  name: string;
  label: string;
  color: RGB;
}

/** Pen, rectangle and text colors. */
export const INK_SWATCHES: Swatch[] = [
  { name: 'black', label: 'Black', color: COLORS.black },
  { name: 'red', label: 'Red', color: COLORS.red },
  { name: 'blue', label: 'Blue', color: COLORS.blue },
  { name: 'green', label: 'Green', color: COLORS.green },
];

/** Highlighter colors: light so they read well with Multiply blending. */
export const HIGHLIGHTER_SWATCHES: Swatch[] = [
  { name: 'yellow', label: 'Yellow', color: COLORS.yellow },
  { name: 'green', label: 'Green', color: { r: 0.7, g: 1, b: 0.35 } },
  { name: 'pink', label: 'Pink', color: { r: 1, g: 0.5, b: 0.67 } },
  { name: 'blue', label: 'Blue', color: { r: 0.5, g: 0.85, b: 1 } },
];

export const PEN_WIDTHS = [1, 2, 3, 5, 8];
export const HIGHLIGHTER_WIDTHS = [8, 14, 20];
export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];

export const FONT_OPTIONS: { value: StandardFontName; label: string }[] = [
  { value: 'Helvetica', label: 'Helvetica' },
  { value: 'Helvetica-Bold', label: 'Helvetica Bold' },
  { value: 'TimesRoman', label: 'Times' },
  { value: 'Courier', label: 'Courier' },
];

export function sameColor(a: RGB | null | undefined, b: RGB | null | undefined, eps = 1 / 255): boolean {
  if (!a || !b) return false;
  return Math.abs(a.r - b.r) < eps && Math.abs(a.g - b.g) < eps && Math.abs(a.b - b.b) < eps;
}

/** `values` plus `current` (sorted) when it is not already in the list, so a <select> can show it. */
export function withCurrent(values: readonly number[], current: number): number[] {
  if (values.includes(current)) return [...values];
  return [...values, current].sort((a, b) => a - b);
}

export function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

const ILLEGAL_FILENAME_CHARS = new Set('\\/:*?"<>|');

/** Drop path separators, Windows-illegal punctuation and control characters. */
function stripIllegalChars(s: string): string {
  let out = '';
  for (const ch of s) {
    if (ch.charCodeAt(0) < 32 || ILLEGAL_FILENAME_CHARS.has(ch)) continue;
    out += ch;
  }
  return out;
}

/**
 * Turn what the user typed into a usable `.pdf` file name. Path separators and
 * characters that are illegal on Windows are removed; an empty result falls
 * back to `fallback`.
 */
export function normalizeOutputName(raw: string, fallback = 'document.pdf'): string {
  let name = stripIllegalChars(raw).trim();
  name = name.replace(/\.pdf$/i, '').replace(/[. ]+$/, '').trim();
  if (!name) {
    const base = fallback.replace(/\.pdf$/i, '') || 'document';
    return `${base}.pdf`;
  }
  return `${name}.pdf`;
}

/** Shortcut hint for tooltips: "Ctrl+S" on Windows/Linux, "⌘S" on macOS. */
export function shortcutLabel(keys: string, isMac: boolean): string {
  if (!isMac) return keys;
  return keys.replace(/Ctrl\+/g, '⌘').replace(/Shift\+/g, '⇧').replace(/Alt\+/g, '⌥');
}

export function detectMac(nav: { platform?: string; userAgent?: string } | undefined): boolean {
  if (!nav) return false;
  const s = `${nav.platform ?? ''} ${nav.userAgent ?? ''}`;
  return /Mac|iPhone|iPad|iPod/i.test(s);
}

// ---------- annotation style editing ----------

/** What kind of style controls an annotation (or the current tool) needs. */
export type StyleKind = 'ink' | 'highlighter' | 'text' | 'highlight-box' | 'whiteout' | 'image' | 'none';

export interface StyleTarget {
  kind: StyleKind;
  color: RGB | null;
  width: number | null;
  font: StandardFontName | null;
  fontSize: number | null;
}

function isWhite(c: RGB | null): boolean {
  return !!c && c.r > 0.97 && c.g > 0.97 && c.b > 0.97;
}

export function isHighlighterInk(a: Annotation): boolean {
  return a.type === 'ink' && (a.opacity < 1 || a.blendMode === 'Multiply');
}

/** Classify an existing annotation so the options bar can edit it. */
export function styleTargetForAnnotation(a: Annotation): StyleTarget {
  switch (a.type) {
    case 'text':
      return { kind: 'text', color: a.color, width: null, font: a.font, fontSize: a.fontSize };
    case 'ink':
      return {
        kind: isHighlighterInk(a) ? 'highlighter' : 'ink',
        color: a.color,
        width: a.strokeWidth,
        font: null,
        fontSize: null,
      };
    case 'rect': {
      if (a.strokeColor) {
        return { kind: 'ink', color: a.strokeColor, width: a.strokeWidth, font: null, fontSize: null };
      }
      if (a.fillColor && !isWhite(a.fillColor)) {
        return { kind: 'highlight-box', color: a.fillColor, width: null, font: null, fontSize: null };
      }
      return { kind: 'whiteout', color: null, width: null, font: null, fontSize: null };
    }
    case 'image':
      return { kind: 'image', color: null, width: null, font: null, fontSize: null };
  }
}

/** Which style controls a tool uses for *new* annotations. */
export function styleKindForTool(tool: Tool): StyleKind {
  switch (tool) {
    case 'pen':
    case 'rect':
      return 'ink';
    case 'highlighter':
      return 'highlighter';
    case 'highlight-box':
      return 'highlight-box';
    case 'text':
      return 'text';
    case 'whiteout':
      return 'whiteout';
    case 'select':
    case 'signature':
      return 'none';
  }
}

/** Patch that recolors an annotation. `null` when the annotation has no editable color. */
export function colorPatch(a: Annotation, color: RGB): Partial<Annotation> | null {
  switch (a.type) {
    case 'text':
    case 'ink':
      return { color };
    case 'rect':
      if (a.strokeColor) return { strokeColor: color };
      if (a.fillColor && !isWhite(a.fillColor)) return { fillColor: color };
      return null;
    case 'image':
      return null;
  }
}

/** Patch that changes the stroke width. `null` when not applicable. */
export function widthPatch(a: Annotation, strokeWidth: number): Partial<Annotation> | null {
  if (a.type === 'ink') return { strokeWidth };
  if (a.type === 'rect' && a.strokeColor) return { strokeWidth };
  return null;
}

/** Patch for text font / size. `null` for non-text annotations. */
export function textPatch(
  a: Annotation,
  patch: { font?: StandardFontName; fontSize?: number },
): Partial<Annotation> | null {
  if (a.type !== 'text') return null;
  const out: Partial<Annotation> = {};
  if (patch.font) (out as { font?: StandardFontName }).font = patch.font;
  if (patch.fontSize) (out as { fontSize?: number }).fontSize = patch.fontSize;
  return out;
}

/** 1-based "current / total" indicator text. */
export function formatPageIndicator(index: number, total: number): string {
  if (total <= 0 || index < 0) return '– / 0';
  return `${index + 1} / ${total}`;
}

/**
 * Pages a page-level toolbar action applies to: in grid view the selection
 * (when there is one), otherwise the page shown in the editor.
 */
export function targetPageIds(s: {
  viewMode: 'editor' | 'grid';
  selectedPageIds: PageId[];
  activePageId: PageId | null;
}): PageId[] {
  if (s.viewMode === 'grid' && s.selectedPageIds.length) return s.selectedPageIds;
  return s.activePageId ? [s.activePageId] : [];
}
