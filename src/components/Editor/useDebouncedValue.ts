import { useEffect, useState } from 'react';

/** The value, but updates are delayed by `delayMs` (the initial value is immediate). */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (Object.is(debounced, value)) return;
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs, debounced]);
  return debounced;
}
