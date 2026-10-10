/** Fit-to-width scale for the editor. Pure. */

/** Horizontal room (CSS px) kept around the page at zoom 1. */
export const FIT_PADDING_PX = 48;
export const MIN_FIT_SCALE = 0.05;

/** Scale (CSS px per point) that fits `displayWidth` into `containerWidth` minus padding. */
export function fitScaleFor(containerWidth: number, displayWidth: number, padding = FIT_PADDING_PX): number {
  if (!(containerWidth > 0) || !(displayWidth > 0)) return 1;
  return Math.max(MIN_FIT_SCALE, (containerWidth - padding) / displayWidth);
}
