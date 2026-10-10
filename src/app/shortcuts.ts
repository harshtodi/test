import { useEffect } from 'react';
import { useEditorStore } from '@/state/store';
import { saveDocument } from '@/app/actions';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** App-wide keyboard shortcuts (undo/redo/save/delete/tool switching). */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useEditorStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveDocument();
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        s.redo();
        return;
      }
      if (isEditableTarget(e.target)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectedAnnotationId && s.activePageId) {
          e.preventDefault();
          s.removeAnnotation(s.activePageId, s.selectedAnnotationId);
        } else if (s.viewMode === 'grid' && s.selectedPageIds.length) {
          e.preventDefault();
          s.removePages(s.selectedPageIds);
        }
        return;
      }
      if (e.key === 'Escape') {
        s.selectAnnotation(null);
        if (s.tool !== 'select') s.setTool('select');
        return;
      }
      if (!mod && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'v':
            s.setTool('select');
            break;
          case 't':
            s.setTool('text');
            break;
          case 'p':
            s.setTool('pen');
            break;
          case 'h':
            s.setTool('highlighter');
            break;
          case 'r':
            s.setTool('rect');
            break;
          case 'w':
            s.setTool('whiteout');
            break;
          case 'g':
            s.setTool('signature');
            break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
