/**
 * Page editor (milestone M3): the main canvas where one page is annotated.
 *
 * - Fits the page to the pane width (ResizeObserver) × store.zoom.
 * - pdf.js renders into a <canvas>; an SVG overlay draws annotations in
 *   display space; an inline <textarea> edits text annotations.
 * - Ctrl/Cmd + wheel zooms around the pointer; plain wheel scrolls the pane.
 *   Toolbar / keyboard / menu zoom keeps the viewport centre in place.
 */
import { useRef, useState } from 'react';
import type { PageGeometry, PageRef, SourceDoc } from '@/core/types';
import { getPageGeometry } from '@/core/geometry';
import { selectActivePage, useEditorStore } from '@/state/store';
import { AnnotationLayer } from './AnnotationLayer';
import { PageCanvas } from './PageCanvas';
import { fitScaleFor } from './tools/fit';
import { useElementWidth } from './useElementWidth';
import { useWheelZoom } from './useWheelZoom';
import './PageEditor.css';

function safeGeometry(page: PageRef, source: SourceDoc): PageGeometry | null {
  try {
    return getPageGeometry(page, source);
  } catch {
    return null;
  }
}

export function PageEditor() {
  const page = useEditorStore(selectActivePage);
  const source = useEditorStore((s) => (page ? s.sources[page.sourceId] : undefined));
  const zoom = useEditorStore((s) => s.zoom);
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const containerWidth = useElementWidth(rootEl);
  const geometry = page && source ? safeGeometry(page, source) : null;
  const scale = (geometry ? fitScaleFor(containerWidth, geometry.displayWidth) : 1) * zoom;
  useWheelZoom(rootEl, pageRef, scale, page ? `${page.id}/${page.rotation}` : null);

  if (!page) {
    return (
      <div ref={setRootEl} className="page-editor page-editor-empty" data-testid="page-editor">
        <p className="page-editor-hint" data-testid="editor-empty-hint">
          Select a page
        </p>
      </div>
    );
  }
  if (!source || !geometry) {
    return (
      <div ref={setRootEl} className="page-editor page-editor-empty" data-testid="page-editor">
        <p className="page-editor-hint" data-testid="editor-empty-hint">
          This page cannot be displayed: its source document is missing.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={setRootEl}
      className="page-editor"
      data-testid="page-editor"
      data-page-id={page.id}
      data-scale={scale.toFixed(4)}
    >
      <div className="page-editor-stage">
        {containerWidth > 0 && (
          <div
            ref={pageRef}
            className="page-editor-page"
            data-testid="page-surface"
            style={{ width: geometry.displayWidth * scale, height: geometry.displayHeight * scale }}
          >
            <PageCanvas page={page} source={source} geometry={geometry} scale={scale} />
            {/* Keyed by page: a gesture (or editor) in progress never carries over to another page's geometry. */}
            <AnnotationLayer key={page.id} page={page} geometry={geometry} scale={scale} />
          </div>
        )}
      </div>
    </div>
  );
}
