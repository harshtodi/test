import { useLayoutEffect, useState } from 'react';

/** Content width (CSS px) of an element, kept up to date with a ResizeObserver. */
export function useElementWidth(el: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        setWidth((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return width;
}
