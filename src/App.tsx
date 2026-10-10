import { useEffect, useRef } from 'react';
import { useEditorStore } from '@/state/store';
import { OPEN_REQUEST_EVENT, openFiles, openFilesViaDialog, saveDocument } from '@/app/actions';
import { getPlatform } from '@/platform';
import { useGlobalShortcuts } from '@/app/shortcuts';
import { DropOverlay, useFileDrop } from '@/components/DropZone';
import { Toolbar } from '@/components/Toolbar/Toolbar';
import { PageGrid } from '@/components/PageGrid/PageGrid';
import { PageEditor } from '@/components/Editor/PageEditor';
import { EmptyState } from '@/components/EmptyState';
import { Notice } from '@/components/Notice';

function isTextField(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function App() {
  const hasPages = useEditorStore((s) => s.pages.length > 0);
  const viewMode = useEditorStore((s) => s.viewMode);
  const dirty = useEditorStore((s) => s.dirty);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragging = useFileDrop((files) => void openFiles(files));
  useGlobalShortcuts();

  // Host integration: files opened via menu / file association, menu commands.
  useEffect(() => {
    const platform = getPlatform();
    const offOpen = platform.onOpenFiles?.((files) => void openFiles(files));
    const offMenu = platform.onMenuCommand?.((cmd) => {
      const s = useEditorStore.getState();
      switch (cmd) {
        case 'open':
          void openFilesViaDialog(() => fileInputRef.current?.click());
          break;
        case 'save':
          void saveDocument();
          break;
        case 'undo':
          // macOS menu accelerators always fire: keep native undo inside text fields
          if (isTextField(document.activeElement)) document.execCommand('undo');
          else s.undo();
          break;
        case 'redo':
          if (isTextField(document.activeElement)) document.execCommand('redo');
          else s.redo();
          break;
        case 'zoom-in':
          s.setZoom(s.zoom * 1.25);
          break;
        case 'zoom-out':
          s.setZoom(s.zoom / 1.25);
          break;
        case 'zoom-reset':
          s.setZoom(1);
          break;
      }
    });
    const onOpenRequest = () => void openFilesViaDialog(() => fileInputRef.current?.click());
    window.addEventListener(OPEN_REQUEST_EVENT, onOpenRequest);
    return () => {
      offOpen?.();
      offMenu?.();
      window.removeEventListener(OPEN_REQUEST_EVENT, onOpenRequest);
    };
  }, []);

  useEffect(() => {
    getPlatform().setDirty?.(dirty);
    if (getPlatform().isElectron) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const requestOpen = () => void openFilesViaDialog(() => fileInputRef.current?.click());

  return (
    <div className="app" data-testid="app">
      <input
        ref={fileInputRef}
        data-testid="file-input"
        type="file"
        accept=".pdf,application/pdf,image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = '';
          void openFiles(files);
        }}
      />
      <Toolbar onOpen={requestOpen} />
      {hasPages ? (
        <div className={`workspace workspace-${viewMode}`}>
          {viewMode === 'editor' ? (
            <>
              <aside className="sidebar" data-testid="sidebar">
                <PageGrid variant="list" />
              </aside>
              <main className="editor-pane">
                <PageEditor />
              </main>
            </>
          ) : (
            <main className="grid-pane">
              <PageGrid variant="grid" />
            </main>
          )}
        </div>
      ) : (
        <EmptyState onOpen={requestOpen} />
      )}
      <DropOverlay visible={dragging} />
      <Notice />
    </div>
  );
}
