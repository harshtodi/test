import { useEffect } from 'react';
import { useEditorStore } from '@/state/store';

export function Notice() {
  const notice = useEditorStore((s) => s.notice);
  const clear = useEditorStore((s) => s.clearNotice);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(clear, notice.kind === 'error' ? 8000 : 3500);
    return () => clearTimeout(t);
  }, [notice, clear]);
  if (!notice) return null;
  return (
    <div className={`notice notice-${notice.kind}`} role="status" data-testid="notice" onClick={clear}>
      {notice.message}
    </div>
  );
}
