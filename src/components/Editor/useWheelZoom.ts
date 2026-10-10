/**
 * Ctrl/Cmd + wheel (and trackpad pinch, which Chromium reports with ctrlKey)
 * zooms the editor around the pointer. Plain wheel events are left alone so
 * the pane scrolls normally.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useEditorStore } from '@/state/store';
import { scrollDeltaForAnchor, wheelZoomFactor } from './tools/zoom';
import type { ZoomAnchor } from './tools/zoom';

/** Nearest ancestor (inclusive) that scrolls, or null. */
export function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el;
  while (node) {
    const { overflowY, overflowX } = getComputedStyle(node);
    if (/(auto|scroll)/.test(overflowY) || /(auto|scroll)/.test(overflowX)) return node;
    node = node.parentElement;
  }
  return null;
}

export function useWheelZoom(rootEl: HTMLElement | null, pageRef: RefObject<HTMLElement | null>, scale: number): void {
  const anchor = useRef<ZoomAnchor | null>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  useEffect(() => {
    if (!rootEl) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const store = useEditorStore.getState();
      const before = store.zoom;
      // Record the anchor *before* touching the store: the re-render (and the
      // layout effect below) may run synchronously inside setZoom.
      const pageEl = pageRef.current;
      if (pageEl) {
        const r = pageEl.getBoundingClientRect();
        const s = scaleRef.current || 1;
        anchor.current = { clientX: e.clientX, clientY: e.clientY, px: (e.clientX - r.left) / s, py: (e.clientY - r.top) / s };
      } else {
        anchor.current = null;
      }
      store.setZoom(before * wheelZoomFactor(e.deltaY, e.deltaMode));
      if (useEditorStore.getState().zoom === before) anchor.current = null; // clamped: nothing to re-anchor
    };
    rootEl.addEventListener('wheel', onWheel, { passive: false });
    return () => rootEl.removeEventListener('wheel', onWheel);
  }, [rootEl, pageRef]);

  // After the new scale has been laid out, scroll so the anchored point stays put.
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a) return;
    anchor.current = null;
    const pageEl = pageRef.current;
    const scroller = findScrollParent(rootEl);
    if (!pageEl || !scroller) return;
    const r = pageEl.getBoundingClientRect();
    const { dx, dy } = scrollDeltaForAnchor(a, r.left, r.top, scale);
    if (dx) scroller.scrollLeft += dx;
    if (dy) scroller.scrollTop += dy;
  }, [scale, rootEl, pageRef]);
}
