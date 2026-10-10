/**
 * Lazy thumbnail loading for the page grid.
 *
 * - `useInView(ref)` flips to `true` once the element scrolls near the visible
 *   area of its scroll container (one shared IntersectionObserver per scroll
 *   root, with a pre-load margin) and stays true for the life of the component.
 * - `useThumbnail(page, source, box, enabled)` asks `src/core/render.ts` for
 *   the (cached, queued) PNG data URL once `enabled` is true and reports the
 *   result for the *current* geometry only. While a re-render for a new
 *   rotation is pending it hands back the previously loaded image as `stale`
 *   (with the rotation it was rendered at) so the tile can show it rotated by
 *   CSS instead of flashing a placeholder.
 */
import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { PageRef, Rotation, SourceDoc } from '@/core/types';
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

/** Size (CSS px) and total rotation a thumbnail is rendered for. */
export interface ThumbBox {
  width: number;
  height: number;
  rotation: Rotation;
}

/** A previously loaded image for the same page, rendered for a different box. */
export interface StaleThumbnail extends ThumbBox {
  src: string;
}

export interface ThumbnailState {
  /** PNG data URL for the page at its current rotation/size, or null while loading. */
  src: string | null;
  error: boolean;
  /** Last image loaded for an earlier rotation/size; only set while `src` is null and no error occurred. */
  stale: StaleThumbnail | null;
}

interface Loaded {
  key: string | null;
  src: string | null;
  error: boolean;
  box: ThumbBox;
}

const NOTHING: Loaded = { key: null, src: null, error: false, box: { width: 0, height: 0, rotation: 0 } };

/** Load (or fetch from the render cache) the thumbnail once `enabled`. */
export function useThumbnail(
  page: PageRef,
  source: SourceDoc | undefined,
  box: ThumbBox,
  enabled: boolean,
): ThumbnailState {
  const { width, height, rotation } = box;
  const key = source ? safeKey(page, source, width) : null;
  const [state, setState] = useState<Loaded>(NOTHING);

  useEffect(() => {
    if (!enabled || !source || key === null) return;
    let cancelled = false;
    const loadedBox: ThumbBox = { width, height, rotation };
    getThumbnailDataUrl(page, source, width).then(
      (src) => {
        if (cancelled) return;
        setState((prev) =>
          prev.key === key && prev.src === src && !prev.error ? prev : { key, src, error: false, box: loadedBox },
        );
      },
      () => {
        if (cancelled) return;
        setState((prev) => (prev.key === key && prev.error ? prev : { key, src: null, error: true, box: loadedBox }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, source, page, key, width, height, rotation]);

  if (key === null) return { src: null, error: true, stale: null };
  if (state.key !== key) {
    return { src: null, error: false, stale: state.src ? { src: state.src, ...state.box } : null };
  }
  return { src: state.src, error: state.error, stale: null };
}

function safeKey(page: PageRef, source: SourceDoc, widthPx: number): string | null {
  try {
    return thumbnailKey(page, source, widthPx);
  } catch {
    return null;
  }
}
