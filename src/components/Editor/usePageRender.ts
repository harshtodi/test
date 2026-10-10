/**
 * Renders the active page into a canvas with pdf.js (src/core/render.ts).
 * The previous render is cancelled whenever the page or scale changes, and
 * scale changes are debounced so zooming does not thrash the renderer.
 */
import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { PageGeometry, PageRef, SourceDoc } from '@/core/types';
import { renderPageToCanvas } from '@/core/render';
import { clampPixelRatio } from './tools/canvas-limits';
import { useDebouncedValue } from './useDebouncedValue';

export const RENDER_DEBOUNCE_MS = 80;

export type RenderStatus = 'rendering' | 'done' | 'error';

export interface PageRenderState {
  status: RenderStatus;
  error: string | null;
  /** Scale (CSS px per point) the bitmap was last rendered at. */
  renderedScale: number | null;
}

export function usePageRender(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  page: PageRef,
  source: SourceDoc,
  geometry: PageGeometry,
  scale: number,
): PageRenderState {
  const renderScale = useDebouncedValue(scale, RENDER_DEBOUNCE_MS);
  const [state, setState] = useState<PageRenderState>({ status: 'rendering', error: null, renderedScale: null });
  const { id, sourceId, sourceIndex, rotation } = page;
  const { displayWidth, displayHeight } = geometry;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Only the geometry-relevant fields matter; a fresh object keeps annotation
    // edits (which replace the PageRef) from re-rendering the PDF.
    const target: PageRef = { id, sourceId, sourceIndex, rotation, annotations: [] };
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const pixelRatio = clampPixelRatio(displayWidth * renderScale, displayHeight * renderScale, dpr);
    let active = true;
    setState((s) => (s.status === 'rendering' ? s : { ...s, status: 'rendering' }));
    const handle = renderPageToCanvas(target, source, canvas, { scale: renderScale, pixelRatio });
    handle.promise.then(
      (result) => {
        if (!active || !result) return;
        setState({ status: 'done', error: null, renderedScale: renderScale });
      },
      (err: unknown) => {
        if (!active) return;
        setState({ status: 'error', error: err instanceof Error ? err.message : String(err), renderedScale: null });
      },
    );
    return () => {
      active = false;
      handle.cancel();
    };
  }, [canvasRef, id, sourceId, sourceIndex, rotation, source, displayWidth, displayHeight, renderScale]);

  return state;
}
