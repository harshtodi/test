/** Pointer bookkeeping for the overlay's one-interaction-at-a-time state machine. Pure. */

export interface IncomingPointer {
  pointerId: number;
  pointerType: string;
}

/**
 * A pointerdown arrived while an interaction is still open. Usually that is a
 * second finger or a pen touching while a finger draws, which is ignored. But
 * when it comes from the same pointer id, or from a mouse (there is only ever
 * one), the pointerup that should have closed the previous interaction was
 * lost (capture failed, the element was re-created...). The stale interaction
 * must then be closed first, otherwise the overlay ignores input forever.
 */
export function isStaleInteraction(activePointerId: number, incoming: IncomingPointer): boolean {
  return incoming.pointerId === activePointerId || incoming.pointerType === 'mouse';
}
