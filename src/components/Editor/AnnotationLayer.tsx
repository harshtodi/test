/**
 * SVG overlay drawn over the page canvas. `viewBox` is the page's display
 * size in points, so shapes are emitted in display coordinates (converted to
 * SVG's y-down axis by tools/svg.ts) and scale with the canvas for free.
 *
 * Children have `pointer-events: none`; the <svg> itself receives every
 * pointer event and useEditorInteractions hit-tests geometrically.
 */
import { useRef } from 'react';
import type { Annotation, PageGeometry, PageRef, TextAnnotation } from '@/core/types';
import { rgbToCss } from '@/core/color';
import { ascent, cssFontFamily, cssFontWeight, lineHeight, splitLines } from '@/core/text-metrics';
import { useEditorStore } from '@/state/store';
import { annotationBounds } from './hit-test';
import { measureTextWidth } from './measure';
import { CORNERS, HANDLE_SIZE_PX, cornerPoint } from './tools/resize';
import { strokePathData, toSvgPoint, toSvgRect } from './tools/svg';
import { TextEditorOverlay } from './TextEditorOverlay';
import { useEditorInteractions } from './useEditorInteractions';

/** Gap (CSS px) between an annotation's bounds and its selection outline. */
export const SELECTION_PAD_PX = 3;

export interface AnnotationLayerProps {
  page: PageRef;
  geometry: PageGeometry;
  scale: number;
}

export function AnnotationLayer({ page, geometry, scale }: AnnotationLayerProps) {
  const tool = useEditorStore((s) => s.tool);
  const selectedId = useEditorStore((s) => s.selectedAnnotationId);
  const svgRef = useRef<SVGSVGElement>(null);
  const ix = useEditorInteractions({ page, geometry, scale, svgRef });
  const { displayWidth: W, displayHeight: H } = geometry;
  const editingId = ix.editing?.annotation.id ?? null;
  const selected = selectedId && selectedId !== editingId ? page.annotations.find((a) => a.id === selectedId) : undefined;

  return (
    <>
      <svg
        ref={svgRef}
        className="annotation-layer"
        data-testid="annotation-layer"
        data-tool={tool}
        data-cursor={ix.cursor}
        width={W * scale}
        height={H * scale}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-label="Annotations"
        {...ix.handlers}
      >
        {page.annotations.map((a) =>
          a.id === editingId ? null : (
            <AnnotationShape key={a.id} annotation={a} displayHeight={H} selected={a.id === selectedId} />
          ),
        )}
        <path ref={ix.inkPreviewRef} className="ink-preview" data-testid="ink-preview" d="" fill="none" />
        <rect ref={ix.rectPreviewRef} className="rect-preview" data-testid="rect-preview" width={0} height={0} />
        {selected && <SelectionOutline annotation={selected} displayHeight={H} scale={scale} />}
      </svg>
      {ix.editing && (
        <TextEditorOverlay
          key={ix.editing.annotation.id}
          session={ix.editing}
          geometry={geometry}
          scale={scale}
          onChange={ix.setEditText}
          onCommit={ix.commitEdit}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

interface ShapeProps {
  annotation: Annotation;
  displayHeight: number;
  selected: boolean;
}

function classes(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

function AnnotationShape({ annotation: a, displayHeight: H, selected }: ShapeProps) {
  const common = {
    'data-testid': 'annotation',
    'data-annotation-id': a.id,
    'data-annotation-type': a.type,
  };
  switch (a.type) {
    case 'ink': {
      const color = rgbToCss(a.color);
      return (
        <g
          {...common}
          className={classes('annotation', selected && 'selected', a.blendMode === 'Multiply' && 'blend-multiply')}
        >
          {a.strokes.map((stroke, i) =>
            stroke.length === 0 ? null : (
              <path
                key={i}
                d={strokePathData(stroke, H)}
                fill="none"
                stroke={color}
                strokeWidth={a.strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={a.opacity}
              />
            ),
          )}
        </g>
      );
    }
    case 'rect': {
      const r = toSvgRect(a, H);
      const hasStroke = a.strokeColor !== null && a.strokeWidth > 0;
      return (
        <rect
          {...common}
          className={classes('annotation', selected && 'selected', a.blendMode === 'Multiply' && 'blend-multiply')}
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          fill={a.fillColor ? rgbToCss(a.fillColor) : 'none'}
          stroke={hasStroke && a.strokeColor ? rgbToCss(a.strokeColor) : 'none'}
          strokeWidth={hasStroke ? a.strokeWidth : 0}
          opacity={a.opacity}
        />
      );
    }
    case 'image': {
      const r = toSvgRect(a, H);
      return (
        <image
          {...common}
          className={classes('annotation', selected && 'selected')}
          href={a.dataUrl}
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          preserveAspectRatio="none"
        />
      );
    }
    case 'text':
      return <TextShape annotation={a} displayHeight={H} selected={selected} common={common} />;
  }
}

interface TextShapeProps {
  annotation: TextAnnotation;
  displayHeight: number;
  selected: boolean;
  common: Record<string, string>;
}

function TextShape({ annotation: a, displayHeight: H, selected, common }: TextShapeProps) {
  const fontSize = a.fontSize > 0 ? a.fontSize : 12;
  const lines = splitLines(a.text);
  const top = toSvgPoint({ x: a.x, y: a.y }, H);
  const baseline = top.y + ascent(fontSize);
  const lh = lineHeight(fontSize);
  return (
    <g
      {...common}
      className={classes('annotation', 'annotation-text', selected && 'selected')}
      fontSize={fontSize}
      fontFamily={cssFontFamily(a.font)}
      fontWeight={cssFontWeight(a.font)}
      fill={rgbToCss(a.color)}
    >
      {lines.map((line, i) =>
        line.length === 0 ? null : (
          <text key={i} x={a.x} y={baseline + i * lh} xmlSpace="preserve">
            {line}
          </text>
        ),
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------

interface SelectionProps {
  annotation: Annotation;
  displayHeight: number;
  scale: number;
}

function SelectionOutline({ annotation, displayHeight: H, scale }: SelectionProps) {
  const bounds = annotationBounds(annotation, measureTextWidth);
  const pad = SELECTION_PAD_PX / scale;
  const box = toSvgRect(
    { x: bounds.x - pad, y: bounds.y - pad, width: bounds.width + 2 * pad, height: bounds.height + 2 * pad },
    H,
  );
  const resizable = annotation.type === 'rect' || annotation.type === 'image';
  const handle = HANDLE_SIZE_PX / scale;
  return (
    <g className="selection" data-testid="selection" data-annotation-id={annotation.id}>
      <rect
        className="selection-box"
        data-testid="selection-box"
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        vectorEffect="non-scaling-stroke"
      />
      {resizable &&
        CORNERS.map((corner) => {
          const p = toSvgPoint(cornerPoint(bounds, corner), H);
          return (
            <rect
              key={corner}
              className="resize-handle"
              data-testid="resize-handle"
              data-corner={corner}
              x={p.x - handle / 2}
              y={p.y - handle / 2}
              width={handle}
              height={handle}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
    </g>
  );
}
