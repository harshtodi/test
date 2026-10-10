/**
 * Ctrl/Cmd + wheel (and trackpad pinch, which Chromium reports with ctrlKey)
 * zooms the editor around the pointer. Plain wheel events are left alone so
 * the pane scrolls normally. Zoom steps that have no pointer (toolbar buttons,
 * Ctrl+=/−, the Electron View menu) keep the page point at the centre of the
 * viewport in place instead of letting the content drift around the page's
 * top-left corner.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useEditorStore } from '@/state/store';
import { centreAnchor, scrollDeltaForAnchor, wheelZoomFactor } from './tools/zoom';
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

interface LastLayout {
  /** The page's top-left corner (viewport CSS px) and scale after the last layout. */
  left: number;
  top: number;
  scale: number;
  key: unknown;
}

export function useWheelZoom(
  rootEl: HTMLElement | null,
  pageRef: RefObject<HTMLElement | null>,
  scale: number,
  /** Identity of the page on screen: a pointer-less zoom is only re-anchored while it is unchanged. */
  pageKey: unknown = null,
): void {
  const anchor = useRef<ZoomAnchor | null>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const last = useRef<LastLayout | null>(null);

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

  // Scrolling moves the page under the viewport: keep the remembered rect current.
  useEffect(() => {
    const scroller = findScrollParent(rootEl);
    if (!scroller) return;
    const onScroll = () => {
      const l = last.current;
      const pageEl = pageRef.current;
      if (!l || !pageEl) return;
      const r = pageEl.getBoundingClientRect();
      l.left = r.left;
      l.top = r.top;
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [rootEl, pageRef]);

  // After the new scale has been laid out, scroll so the anchored point stays put: the point
  // under the pointer for a wheel zoom, else (same page, new scale) the viewport centre.
  useLayoutEffect(() => {
    let a = anchor.current;
    anchor.current = null;
    const pageEl = pageRef.current;
    const scroller = findScrollParent(rootEl);
    if (!pageEl || !scroller) {
      last.current = null;
      return;
    }
    const prev = last.current;
    if (!a && prev && Object.is(prev.key, pageKey) && prev.scale !== scale) {
      a = centreAnchor(scroller.getBoundingClientRect(), prev.left, prev.top, prev.scale);
    }
    if (a) {
      const r = pageEl.getBoundingClientRect();
      const { dx, dy } = scrollDeltaForAnchor(a, r.left, r.top, scale);
      if (dx) scroller.scrollLeft += dx;
      if (dy) scroller.scrollTop += dy;
    }
    const r = pageEl.getBoundingClientRect();
    last.current = { left: r.left, top: r.top, scale, key: pageKey };
  }, [scale, rootEl, pageRef, pageKey]);
}
