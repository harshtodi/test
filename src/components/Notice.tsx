import { useEffect } from 'react';
import { useEditorStore } from '@/state/store';

export function Notice() {
  const notice = useEditorStore((s) => s.notice);
  const busy = useEditorStore((s) => s.busy);
  const clear = useEditorStore((s) => s.clearNotice);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(clear, notice.kind === 'error' ? 8000 : 3500);
    return () => clearTimeout(t);
  }, [notice, clear]);
  if (notice) {
    return (
      <div className={`notice notice-${notice.kind}`} role="status" data-testid="notice" onClick={clear}>
        {notice.message}
      </div>
    );
  }
  if (busy) {
    // Progress for long saves/imports. CSS delays its appearance so quick
    // operations never flash it.
    return (
      <div className="notice notice-busy" role="status" aria-live="polite" data-testid="busy-indicator" data-busy={busy}>
        {busy === 'saving' ? 'Saving…' : 'Importing…'}
      </div>
    );
  }
  return null;
}
