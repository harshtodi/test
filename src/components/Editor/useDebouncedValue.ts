import { useEffect, useState } from 'react';

/**
 * The value, but updates are delayed by `delayMs` (the initial value is immediate).
 *
 * When `resetKey` changes, the new value is returned at once, without the
 * delay: the debounce coalesces changes of the *same* thing (zoom steps) and
 * must not lag behind a switch to a different one (another page's fit scale),
 * which would show the first frames at the previous value.
 */
export function useDebouncedValue<T>(value: T, delayMs: number, resetKey?: unknown): T {
  const [state, setState] = useState({ value, resetKey });
  const reset = !Object.is(state.resetKey, resetKey);
  useEffect(() => {
    if (reset) {
      setState({ value, resetKey });
      return;
    }
    if (Object.is(state.value, value)) return;
    const t = setTimeout(() => setState({ value, resetKey }), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs, resetKey, reset, state.value]);
  return reset ? value : state.value;
}
