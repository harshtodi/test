import { useEffect } from 'react';
import { useEditorStore } from '@/state/store';
import { requestOpenFiles, saveDocument } from '@/app/actions';

/**
 * Any form control: the single-letter tool keys and Escape must not fire here
 * (a <select> has native type-ahead, text fields type the letter).
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

const NON_TEXT_INPUT_TYPES = new Set(['color', 'checkbox', 'radio', 'range', 'file', 'button', 'submit', 'reset']);

/**
 * Controls that edit text, where Ctrl+Z / Delete have a native meaning we
 * must leave alone. A <select> or a colour input has none, so the document
 * shortcuts still work while one of them keeps focus after a change.
 */
function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === 'TEXTAREA' || target.isContentEditable) return true;
  return target instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(target.type);
}

/** App-wide keyboard shortcuts (undo/redo/save/delete/tool switching). */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return; // a component already handled this key
      const s = useEditorStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveDocument();
        return;
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        requestOpenFiles();
        return;
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        s.setZoom(s.zoom * 1.25);
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        s.setZoom(s.zoom / 1.25);
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        s.setZoom(1);
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        if (isTextEntryTarget(e.target)) return;
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        if (isTextEntryTarget(e.target)) return;
        e.preventDefault();
        s.redo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (isTextEntryTarget(e.target)) return;
        // Route by what the user is looking at: thumbnails do not show
        // annotations, so a lingering annotation selection must not win in the grid.
        if (s.viewMode === 'grid') {
          if (s.selectedPageIds.length) {
            e.preventDefault();
            s.removePages(s.selectedPageIds);
          }
        } else if (s.selectedAnnotationId && s.activePageId) {
          e.preventDefault();
          s.removeAnnotation(s.activePageId, s.selectedAnnotationId);
        }
        return;
      }
      if (isEditableTarget(e.target)) return;
      if (e.key === 'Escape') {
        s.selectAnnotation(null);
        if (s.tool !== 'select') s.setTool('select');
        return;
      }
      // Tool keys mirror the toolbar: tools exist only in the editor with pages.
      if (s.pages.length === 0 || s.viewMode !== 'editor') return;
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
            // mirrors the Sign button: pick a signature first when none is chosen
            s.setTool('signature');
            if (!s.currentSignature) s.setSignatureDialogOpen(true);
            break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
