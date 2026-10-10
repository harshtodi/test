/**
 * The pdf.js canvas for one page. Its CSS size follows the scale immediately
 * (stretching the old bitmap) while the debounced re-render catches up.
 */
import { useLayoutEffect, useRef } from 'react';
import type { PageGeometry, PageRef, SourceDoc } from '@/core/types';
import { usePageRender } from './usePageRender';

export interface PageCanvasProps {
  page: PageRef;
  source: SourceDoc;
  geometry: PageGeometry;
  scale: number;
}

export function PageCanvas({ page, source, geometry, scale }: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const render = usePageRender(canvasRef, page, source, geometry, scale);
  const widthPx = geometry.displayWidth * scale;
  const heightPx = geometry.displayHeight * scale;
  // `done` means the bitmap matches the *current* scale; while the debounced
  // re-render is pending the stretched old bitmap is shown and we report `rendering`.
  const status = render.status === 'done' && render.renderedScale !== scale ? 'rendering' : render.status;
  const { renderedScale } = render;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.width = `${widthPx}px`;
    canvas.style.height = `${heightPx}px`;
    // render.ts also sets the CSS size (at the scale it rendered). A render that
    // started before a zoom lands with the old size, so re-apply when one finishes.
  }, [widthPx, heightPx, renderedScale]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="page-canvas"
        data-testid="page-canvas"
        data-render-status={status}
        data-render-scale={renderedScale === null ? undefined : renderedScale.toFixed(4)}
        aria-label="Page"
      />
      {render.status === 'error' && (
        <div className="page-render-error" data-testid="page-render-error" role="alert">
          <strong>Could not render this page.</strong>
          <span>{render.error}</span>
        </div>
      )}
    </>
  );
}
