/** Small unique id helper that works in browsers, Electron and Node tests. */
export function newId(prefix = ''): string {
  const c = globalThis.crypto;
  const raw =
    c && typeof c.randomUUID === 'function'
      ? c.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${raw}` : raw;
}
