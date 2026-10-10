/**
 * Lazy thumbnail loading for the page grid.
 *
 * - `useInView(ref)` flips to `true` once the element scrolls near the visible
 *   area of its scroll container (one shared IntersectionObserver per scroll
 *   root, with a pre-load margin) and stays true for the life of the component.
 * - `useThumbnail(page, source, widthPx, enabled)` asks `src/core/render.ts`
 *   for the (cached, queued) PNG data URL once `enabled` is true and reports the
 *   result for the *current* geometry only, so a rotated page shows its new
 *   aspect-ratio placeholder instead of a stale, wrongly oriented image.
 */
import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { PageRef, SourceDoc } from '@/core/types';
import { getThumbnailDataUrl, thumbnailKey } from '@/core/render';

const PRELOAD_MARGIN = '320px 0px 320px 0px';

type VisibleCallback = () => void;
const callbacks = new WeakMap<Element, VisibleCallback>();
const observers = new WeakMap<Element, IntersectionObserver>();
let viewportObserver: IntersectionObserver | null = null;
const scrollRootCache = new WeakMap<Element, Element | null>();

function onIntersect(entries: IntersectionObserverEntry[], observer: IntersectionObserver): void {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const cb = callbacks.get(entry.target);
    callbacks.delete(entry.target);
    observer.unobserve(entry.target);
    cb?.();
  }
}

/** Nearest ancestor that scrolls vertically (the sidebar / grid pane), cached per parent. */
function findScrollRoot(el: Element): Element | null {
  const parent = el.parentElement;
  if (!parent) return null;
  const cached = scrollRootCache.get(parent);
  if (cached !== undefined) return cached;
  let node: Element | null = parent;
  let root: Element | null = null;
  while (node && node !== document.body) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') {
      root = node;
      break;
    }
    node = node.parentElement;
  }
  scrollRootCache.set(parent, root);
  return root;
}

function observerFor(root: Element | null): IntersectionObserver {
  if (root) {
    let io = observers.get(root);
    if (!io) {
      io = new IntersectionObserver(onIntersect, { root, rootMargin: PRELOAD_MARGIN });
      observers.set(root, io);
    }
    return io;
  }
  if (!viewportObserver) viewportObserver = new IntersectionObserver(onIntersect, { rootMargin: PRELOAD_MARGIN });
  return viewportObserver;
}

/** True once the element has come (close to) into view; latches. */
export function useInView(ref: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (inView) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = observerFor(findScrollRoot(el));
    callbacks.set(el, () => setInView(true));
    io.observe(el);
    return () => {
      callbacks.delete(el);
      io.unobserve(el);
    };
  }, [ref, inView]);
  return inView;
}

export interface ThumbnailState {
  /** PNG data URL for the page at its current rotation, or null while loading. */
  src: string | null;
  error: boolean;
}

/** Load (or fetch from the render cache) the thumbnail once `enabled`. */
export function useThumbnail(
  page: PageRef,
  source: SourceDoc | undefined,
  widthPx: number,
  enabled: boolean,
): ThumbnailState {
  const key = source ? safeKey(page, source, widthPx) : null;
  const [state, setState] = useState<{ key: string | null; src: string | null; error: boolean }>({
    key: null,
    src: null,
    error: false,
  });

  useEffect(() => {
    if (!enabled || !source || key === null) return;
    let cancelled = false;
    getThumbnailDataUrl(page, source, widthPx).then(
      (src) => {
        if (cancelled) return;
        setState((prev) => (prev.key === key && prev.src === src && !prev.error ? prev : { key, src, error: false }));
      },
      () => {
        if (cancelled) return;
        setState((prev) => (prev.key === key && prev.error ? prev : { key, src: null, error: true }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, source, page, widthPx, key]);

  if (key === null) return { src: null, error: true };
  if (state.key !== key) return { src: null, error: false };
  return { src: state.src, error: state.error };
}

function safeKey(page: PageRef, source: SourceDoc, widthPx: number): string | null {
  try {
    return thumbnailKey(page, source, widthPx);
  } catch {
    return null;
  }
}
