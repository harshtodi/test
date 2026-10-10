import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useEditorStore } from '@/state/store';
import { saveDocument, saveSelectedPages } from '@/app/actions';
import { releaseAllSources } from '@/core/render';
import { createBlankPageSource } from '@/core/import';
import { getPageGeometry } from '@/core/geometry';
import type { Tool } from '@/core/types';
import { PAGE_SIZES } from '@/core/types';
import { SignatureDialog } from '@/components/Signature/SignatureDialog';
import { FileName } from './FileName';
import { OverflowMenu } from './OverflowMenu';
import { ToolOptions } from './ToolOptions';
import { detectMac, formatPageIndicator, formatZoom, shortcutLabel, targetPageIds } from './helpers';
import {
  BlankPageIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CursorIcon,
  EditorIcon,
  FolderOpenIcon,
  GridIcon,
  HighlightBoxIcon,
  HighlighterIcon,
  MinusIcon,
  MoreIcon,
  PenIcon,
  PlusIcon,
  RectIcon,
  RedoIcon,
  RotateCcwIcon,
  RotateCwIcon,
  SaveIcon,
  SignatureIcon,
  TextIcon,
  TrashIcon,
  UndoIcon,
  WhiteoutIcon,
} from './icons';
import './Toolbar.css';

interface ToolSpec {
  tool: Tool;
  label: string;
  /** Single-key shortcut from src/app/shortcuts.ts, if any. */
  key?: string;
  icon: ReactNode;
}

const TOOLS: ToolSpec[] = [
  { tool: 'select', label: 'Select', key: 'V', icon: <CursorIcon /> },
  { tool: 'text', label: 'Text', key: 'T', icon: <TextIcon /> },
  { tool: 'pen', label: 'Pen', key: 'P', icon: <PenIcon /> },
  { tool: 'highlighter', label: 'Highlighter', key: 'H', icon: <HighlighterIcon /> },
  { tool: 'rect', label: 'Rectangle', key: 'R', icon: <RectIcon /> },
  { tool: 'highlight-box', label: 'Highlight box', icon: <HighlightBoxIcon /> },
  { tool: 'whiteout', label: 'Whiteout', key: 'W', icon: <WhiteoutIcon /> },
];

function Divider() {
  return <span className="tb-divider" role="separator" aria-orientation="vertical" />;
}

export function Toolbar({ onOpen }: { onOpen: () => void }) {
  const hasPages = useEditorStore((s) => s.pages.length > 0);
  const pageCount = useEditorStore((s) => s.pages.length);
  const activeIndex = useEditorStore((s) => s.pages.findIndex((p) => p.id === s.activePageId));
  const dirty = useEditorStore((s) => s.dirty);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const viewMode = useEditorStore((s) => s.viewMode);
  const tool = useEditorStore((s) => s.tool);
  const zoom = useEditorStore((s) => s.zoom);
  const hasPageTarget = useEditorStore((s) => targetPageIds(s).length > 0);
  const isMac = useMemo(() => detectMac(typeof navigator !== 'undefined' ? navigator : undefined), []);
  const sc = (keys: string) => shortcutLabel(keys, isMac);

  const editor = viewMode === 'editor';
  const toolsEnabled = editor && hasPages;

  // ----- actions (read fresh state inside handlers) -----

  const closeDocument = () => {
    const s = useEditorStore.getState();
    if (s.pages.length === 0) return;
    const message = s.dirty
      ? 'Close this document? Unsaved changes will be lost.'
      : 'Close this document?';
    if (!window.confirm(message)) return;
    s.clearDocument();
    void releaseAllSources();
  };

  const goTo = (delta: number) => {
    const s = useEditorStore.getState();
    const idx = s.pages.findIndex((p) => p.id === s.activePageId);
    const next = s.pages[idx + delta];
    if (!next) return;
    s.setActivePage(next.id);
    s.selectPages([next.id]);
  };

  const rotate = (delta: 90 | -90) => {
    const s = useEditorStore.getState();
    s.rotatePages(targetPageIds(s), delta);
  };

  const deletePages = () => {
    const s = useEditorStore.getState();
    s.removePages(targetPageIds(s));
  };

  const insertBlank = async () => {
    const s = useEditorStore.getState();
    const ids = targetPageIds(s);
    const anchorId = ids[ids.length - 1] ?? null;
    const index = anchorId ? s.pages.findIndex((p) => p.id === anchorId) : s.pages.length - 1;
    const page = s.pages[index];
    let size: { width: number; height: number } = PAGE_SIZES.Letter;
    if (page) {
      const source = s.sources[page.sourceId];
      if (source) {
        try {
          const g = getPageGeometry(page, source);
          size = { width: g.displayWidth, height: g.displayHeight };
        } catch {
          /* fall back to Letter */
        }
      }
    }
    try {
      const source = await createBlankPageSource(size.width, size.height);
      const newIds = useEditorStore.getState().addSource(source, index + 1);
      const after = useEditorStore.getState();
      after.selectPages(newIds);
      const first = newIds[0];
      if (first) after.setActivePage(first);
    } catch (err) {
      useEditorStore.getState().notify('error', `Could not insert a blank page: ${(err as Error).message}`);
    }
  };

  const pickTool = (t: Tool) => useEditorStore.getState().setTool(t);

  const sign = () => {
    const s = useEditorStore.getState();
    s.setTool('signature');
    if (!s.currentSignature) s.setSignatureDialogOpen(true);
  };

  const openSignaturePicker = () => useEditorStore.getState().setSignatureDialogOpen(true);

  const zoomBy = (factor: number) => {
    const s = useEditorStore.getState();
    s.setZoom(s.zoom * factor);
  };

  const pageWord = viewMode === 'grid' ? 'selected pages' : 'current page';

  return (
    <>
      <header className="toolbar" data-testid="toolbar" role="toolbar" aria-label="Main toolbar">
        {/* 1. File */}
        <div className="tb-group" role="group" aria-label="File">
          <button type="button" className="btn btn-icon" data-testid="tb-open" title="Open files…" aria-label="Open files" onClick={onOpen}>
            <FolderOpenIcon />
          </button>
          <button
            type="button"
            className="btn btn-icon tb-save"
            data-testid="tb-save"
            data-dirty={dirty ? 'true' : 'false'}
            title={`Save (${sc('Ctrl+S')})${dirty ? ' — unsaved changes' : ''}`}
            aria-label={dirty ? 'Save (unsaved changes)' : 'Save'}
            disabled={!hasPages}
            onClick={() => void saveDocument()}
          >
            <SaveIcon />
            {dirty && <span className="tb-dirty-dot" aria-hidden="true" />}
          </button>
          <OverflowMenu
            label="More file actions"
            testId="tb-menu"
            items={[
              {
                id: 'save-selected',
                label: 'Save selected pages as…',
                testId: 'tb-save-selected',
                disabled: !hasPages,
                onSelect: () => void saveSelectedPages(),
              },
              {
                id: 'close',
                label: 'Close document',
                testId: 'tb-close-doc',
                disabled: !hasPages,
                danger: true,
                onSelect: closeDocument,
              },
            ]}
          >
            <MoreIcon />
          </OverflowMenu>
          <FileName />
        </div>

        <Divider />

        {/* 2. History */}
        <div className="tb-group" role="group" aria-label="History">
          <button
            type="button"
            className="btn btn-icon"
            data-testid="tb-undo"
            title={`Undo (${sc('Ctrl+Z')})`}
            aria-label="Undo"
            disabled={!canUndo}
            onClick={() => useEditorStore.getState().undo()}
          >
            <UndoIcon />
          </button>
          <button
            type="button"
            className="btn btn-icon"
            data-testid="tb-redo"
            title={`Redo (${sc('Ctrl+Shift+Z')})`}
            aria-label="Redo"
            disabled={!canRedo}
            onClick={() => useEditorStore.getState().redo()}
          >
            <RedoIcon />
          </button>
        </div>

        <Divider />

        {/* 3. View + page operations */}
        <div className="tb-group" role="group" aria-label="View">
          <div className="tb-segmented" role="radiogroup" aria-label="View mode">
            <button
              type="button"
              role="radio"
              aria-checked={viewMode === 'grid'}
              className={`btn tb-seg${viewMode === 'grid' ? ' active' : ''}`}
              data-testid="tb-view-grid"
              title="Arrange pages (grid view)"
              onClick={() => useEditorStore.getState().setViewMode('grid')}
            >
              <GridIcon />
              <span className="tb-label">Pages</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={viewMode === 'editor'}
              className={`btn tb-seg${viewMode === 'editor' ? ' active' : ''}`}
              data-testid="tb-view-editor"
              title="Edit the current page"
              onClick={() => useEditorStore.getState().setViewMode('editor')}
            >
              <EditorIcon />
              <span className="tb-label">Editor</span>
            </button>
          </div>

          {editor && (
            <div className="tb-pager">
              <button
                type="button"
                className="btn btn-icon"
                data-testid="tb-prev-page"
                title="Previous page"
                aria-label="Previous page"
                disabled={activeIndex <= 0}
                onClick={() => goTo(-1)}
              >
                <ChevronLeftIcon />
              </button>
              <span className="tb-page-indicator" data-testid="tb-page-indicator" aria-live="polite" aria-label="Current page">
                {formatPageIndicator(activeIndex, pageCount)}
              </span>
              <button
                type="button"
                className="btn btn-icon"
                data-testid="tb-next-page"
                title="Next page"
                aria-label="Next page"
                disabled={activeIndex < 0 || activeIndex >= pageCount - 1}
                onClick={() => goTo(1)}
              >
                <ChevronRightIcon />
              </button>
            </div>
          )}

          <button
            type="button"
            className="btn btn-icon"
            data-testid="tb-rotate-ccw"
            title={`Rotate ${pageWord} left`}
            aria-label={`Rotate ${pageWord} left`}
            disabled={!hasPageTarget}
            onClick={() => rotate(-90)}
          >
            <RotateCcwIcon />
          </button>
          <button
            type="button"
            className="btn btn-icon"
            data-testid="tb-rotate-cw"
            title={`Rotate ${pageWord} right`}
            aria-label={`Rotate ${pageWord} right`}
            disabled={!hasPageTarget}
            onClick={() => rotate(90)}
          >
            <RotateCwIcon />
          </button>
          <button
            type="button"
            className="btn btn-icon tb-danger"
            data-testid="tb-delete-page"
            title={`Delete ${pageWord}`}
            aria-label={`Delete ${pageWord}`}
            disabled={!hasPageTarget}
            onClick={deletePages}
          >
            <TrashIcon />
          </button>
          <button
            type="button"
            className="btn btn-icon"
            data-testid="tb-insert-blank"
            title={`Insert blank page after ${pageWord}`}
            aria-label={`Insert blank page after ${pageWord}`}
            disabled={!hasPageTarget}
            onClick={() => void insertBlank()}
          >
            <BlankPageIcon />
          </button>
        </div>

        <Divider />

        {/* 4. Tools */}
        <div className="tb-group tb-tools" role="radiogroup" aria-label="Tools">
          {TOOLS.map((t) => (
            <button
              key={t.tool}
              type="button"
              role="radio"
              aria-checked={tool === t.tool}
              className={`btn btn-icon${tool === t.tool ? ' active' : ''}`}
              data-testid={`tool-${t.tool}`}
              title={t.key ? `${t.label} (${t.key})` : t.label}
              aria-label={t.label}
              disabled={!toolsEnabled}
              onClick={() => pickTool(t.tool)}
            >
              {t.icon}
            </button>
          ))}
          <div className={`tb-split${tool === 'signature' ? ' active' : ''}`}>
            <button
              type="button"
              role="radio"
              aria-checked={tool === 'signature'}
              className={`btn btn-icon tb-split-main${tool === 'signature' ? ' active' : ''}`}
              data-testid="tool-signature"
              title="Sign (G)"
              aria-label="Sign"
              disabled={!toolsEnabled}
              onClick={sign}
            >
              <SignatureIcon />
            </button>
            <button
              type="button"
              className={`btn btn-icon tb-split-caret${tool === 'signature' ? ' active' : ''}`}
              data-testid="tool-signature-pick"
              title="Choose or create a signature"
              aria-label="Choose or create a signature"
              aria-haspopup="dialog"
              disabled={!toolsEnabled}
              onClick={openSignaturePicker}
            >
              <ChevronDownIcon />
            </button>
          </div>
        </div>

        {/* 5. Tool options (context sensitive; renders nothing in grid view) */}
        <ToolOptions />

        <span className="tb-spacer" />

        {/* 6. Zoom */}
        <div className="tb-group tb-zoom" role="group" aria-label="Zoom">
          <button
            type="button"
            className="btn btn-icon"
            data-testid="tb-zoom-out"
            title="Zoom out"
            aria-label="Zoom out"
            disabled={!editor || !hasPages || zoom <= 0.25}
            onClick={() => zoomBy(1 / 1.25)}
          >
            <MinusIcon />
          </button>
          <button
            type="button"
            className="btn tb-zoom-level"
            data-testid="tb-zoom-level"
            title="Reset zoom (fit width)"
            aria-label={`Zoom ${formatZoom(zoom)}. Reset to fit width`}
            disabled={!editor || !hasPages}
            onClick={() => useEditorStore.getState().setZoom(1)}
          >
            {formatZoom(zoom)}
          </button>
          <button
            type="button"
            className="btn btn-icon"
            data-testid="tb-zoom-in"
            title="Zoom in"
            aria-label="Zoom in"
            disabled={!editor || !hasPages || zoom >= 4}
            onClick={() => zoomBy(1.25)}
          >
            <PlusIcon />
          </button>
        </div>
      </header>
      <SignatureDialog />
    </>
  );
}
