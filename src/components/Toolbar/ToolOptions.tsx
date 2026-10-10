import { useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { useEditorStore } from '@/state/store';
import type { Annotation, RGB, StandardFontName } from '@/core/types';
import { ColorPicker } from './ColorPicker';
import {
  FONT_OPTIONS,
  FONT_SIZES,
  HIGHLIGHTER_SWATCHES,
  HIGHLIGHTER_WIDTHS,
  INK_SWATCHES,
  PEN_WIDTHS,
  colorPatch,
  styleKindForTool,
  styleTargetForAnnotation,
  textPatch,
  widthPatch,
  withCurrent,
} from './helpers';
import type { StyleKind, Swatch } from './helpers';
import { TrashIcon } from './icons';

/** Continuous color-picker drags within this window collapse into one undo step. */
const GROUP_WINDOW_MS = 800;

function WidthSelect({ values, value, onChange }: { values: readonly number[]; value: number; onChange: (v: number) => void }) {
  return (
    <label className="tb-field" title="Stroke width (points)">
      <span className="tb-label">Width</span>
      <select
        className="tb-select"
        data-testid="opt-stroke-width"
        aria-label="Stroke width"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {withCurrent(values, value).map((w) => (
          <option key={w} value={w}>
            {w} pt
          </option>
        ))}
      </select>
    </label>
  );
}

function FontControls({
  font,
  fontSize,
  onFont,
  onSize,
}: {
  font: StandardFontName;
  fontSize: number;
  onFont: (f: StandardFontName) => void;
  onSize: (s: number) => void;
}) {
  return (
    <>
      <label className="tb-field" title="Font">
        <span className="tb-label">Font</span>
        <select
          className="tb-select tb-select-font"
          data-testid="opt-font"
          aria-label="Font"
          value={font}
          onChange={(e) => onFont(e.target.value as StandardFontName)}
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <label className="tb-field" title="Font size (points)">
        <span className="tb-label">Size</span>
        <select
          className="tb-select"
          data-testid="opt-font-size"
          aria-label="Font size"
          value={fontSize}
          onChange={(e) => onSize(Number(e.target.value))}
        >
          {withCurrent(FONT_SIZES, fontSize).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/** Options editing the *selected* annotation. */
function AnnotationOptions({ pageId, annotation }: { pageId: string; annotation: Annotation }) {
  const updateAnnotation = useEditorStore((s) => s.updateAnnotation);
  const removeAnnotation = useEditorStore((s) => s.removeAnnotation);
  const commitHistory = useEditorStore((s) => s.commitHistory);
  const lastTransientRef = useRef(0);
  const target = styleTargetForAnnotation(annotation);

  const apply = useCallback(
    (patch: Partial<Annotation> | null) => {
      if (patch) updateAnnotation(pageId, annotation.id, patch, true);
    },
    [updateAnnotation, pageId, annotation.id],
  );

  /** For the continuous native color picker: one undo step per burst of changes. */
  const applyGrouped = useCallback(
    (patch: Partial<Annotation> | null) => {
      if (!patch) return;
      const now = Date.now();
      if (now - lastTransientRef.current > GROUP_WINDOW_MS) commitHistory();
      lastTransientRef.current = now;
      updateAnnotation(pageId, annotation.id, patch, false);
    },
    [commitHistory, updateAnnotation, pageId, annotation.id],
  );

  const onColor = (c: RGB, fromCustom: boolean) => {
    const patch = colorPatch(annotation, c);
    if (fromCustom) applyGrouped(patch);
    else apply(patch);
  };

  const swatches = target.kind === 'highlighter' || target.kind === 'highlight-box' ? HIGHLIGHTER_SWATCHES : INK_SWATCHES;
  const widths = target.kind === 'highlighter' ? HIGHLIGHTER_WIDTHS : PEN_WIDTHS;

  return (
    <>
      {target.kind === 'text' && target.font && target.fontSize !== null && (
        <FontControls
          font={target.font}
          fontSize={target.fontSize}
          onFont={(font) => apply(textPatch(annotation, { font }))}
          onSize={(fontSize) => apply(textPatch(annotation, { fontSize }))}
        />
      )}
      {target.color && (
        <GroupedColorPicker
          swatches={swatches}
          value={target.color}
          custom={target.kind === 'ink' || target.kind === 'text'}
          label={target.kind === 'text' ? 'Text color' : target.kind === 'ink' ? 'Color' : 'Highlight color'}
          onColor={onColor}
        />
      )}
      {target.width !== null && (
        <WidthSelect values={widths} value={target.width} onChange={(w) => apply(widthPatch(annotation, w))} />
      )}
      <button
        type="button"
        className="btn btn-icon tb-danger"
        data-testid="opt-delete-annotation"
        title="Delete selected annotation (Delete)"
        aria-label="Delete selected annotation"
        onClick={() => removeAnnotation(pageId, annotation.id)}
      >
        <TrashIcon />
      </button>
    </>
  );
}

/**
 * ColorPicker wrapper that tells the parent whether a change came from a
 * swatch click or from the native color input (which fires continuously).
 */
function GroupedColorPicker({
  swatches,
  value,
  custom,
  label,
  onColor,
}: {
  swatches: Swatch[];
  value: RGB;
  custom: boolean;
  label: string;
  onColor: (c: RGB, fromCustom: boolean) => void;
}) {
  // The ColorPicker calls one onChange for both; distinguish by matching a swatch.
  return (
    <ColorPicker
      swatches={swatches}
      value={value}
      custom={custom}
      label={label}
      onChange={(c) => onColor(c, !swatches.some((s) => s.color === c))}
    />
  );
}

/** Options for the *current tool* (new annotations). */
function ToolDefaults({ kind }: { kind: StyleKind }) {
  const settings = useEditorStore((s) => s.toolSettings);
  const setToolSettings = useEditorStore((s) => s.setToolSettings);

  switch (kind) {
    case 'ink':
      return (
        <>
          <ColorPicker
            swatches={INK_SWATCHES}
            value={settings.color}
            custom
            label="Color"
            onChange={(color) => setToolSettings({ color })}
          />
          <WidthSelect values={PEN_WIDTHS} value={settings.strokeWidth} onChange={(strokeWidth) => setToolSettings({ strokeWidth })} />
        </>
      );
    case 'highlighter':
      return (
        <>
          <ColorPicker
            swatches={HIGHLIGHTER_SWATCHES}
            value={settings.highlighterColor}
            label="Highlight color"
            onChange={(highlighterColor) => setToolSettings({ highlighterColor })}
          />
          <WidthSelect
            values={HIGHLIGHTER_WIDTHS}
            value={settings.highlighterWidth}
            onChange={(highlighterWidth) => setToolSettings({ highlighterWidth })}
          />
        </>
      );
    case 'highlight-box':
      return (
        <ColorPicker
          swatches={HIGHLIGHTER_SWATCHES}
          value={settings.highlighterColor}
          label="Highlight color"
          onChange={(highlighterColor) => setToolSettings({ highlighterColor })}
        />
      );
    case 'text':
      return (
        <>
          <FontControls
            font={settings.font}
            fontSize={settings.fontSize}
            onFont={(font) => setToolSettings({ font })}
            onSize={(fontSize) => setToolSettings({ fontSize })}
          />
          <ColorPicker
            swatches={INK_SWATCHES}
            value={settings.textColor}
            custom
            label="Text color"
            onChange={(textColor) => setToolSettings({ textColor })}
          />
        </>
      );
    case 'whiteout':
      return <span className="tb-hint">Drag over content to cover it</span>;
    case 'image':
    case 'none':
      return null;
  }
}

/**
 * Context-sensitive style options. With an annotation selected they edit that
 * annotation (recorded in history); otherwise they set the defaults for the
 * current tool. Nothing is shown in grid view.
 */
export function ToolOptions() {
  const viewMode = useEditorStore((s) => s.viewMode);
  const tool = useEditorStore((s) => s.tool);
  const activePageId = useEditorStore((s) => s.activePageId);
  const hasSignature = useEditorStore((s) => s.currentSignature !== null);
  const selected = useEditorStore((s) => {
    if (!s.selectedAnnotationId || !s.activePageId) return null;
    const page = s.pages.find((p) => p.id === s.activePageId);
    return page?.annotations.find((a) => a.id === s.selectedAnnotationId) ?? null;
  });

  if (viewMode !== 'editor') return null;

  let content: ReactNode;
  if (selected && activePageId) {
    // Keyed by id: the color-picker grouping timer must start fresh for every annotation.
    content = <AnnotationOptions key={selected.id} pageId={activePageId} annotation={selected} />;
  } else if (tool === 'signature') {
    content = <span className="tb-hint">{hasSignature ? 'Click on the page to place your signature' : 'Create a signature to place'}</span>;
  } else {
    const kind = styleKindForTool(tool);
    if (kind === 'none' || kind === 'image') return null;
    content = <ToolDefaults kind={kind} />;
  }

  return (
    <div className="tb-group tb-options" data-testid="tool-options" data-editing={selected ? 'annotation' : 'tool'}>
      {content}
    </div>
  );
}
