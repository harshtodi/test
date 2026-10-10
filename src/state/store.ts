import { create } from 'zustand';
import type {
  Annotation,
  AnnotationId,
  PageId,
  PageRef,
  Rotation,
  SourceDoc,
  SourceId,
  Tool,
  ToolSettings,
} from '@/core/types';
import { DEFAULT_TOOL_SETTINGS } from '@/core/types';
import { addRotation, getPageGeometry } from '@/core/geometry';
import { newId } from '@/core/ids';
import { rotateAnnotation } from '@/core/annotation-transform';

/**
 * Single source of truth for the working document.
 *
 * - `sources` are immutable imported PDFs (never removed while the app runs).
 * - `pages` is the ordered list of pages in the output document, each carrying
 *   its own annotations.
 * - Every mutating action that changes `pages` records an undo snapshot unless
 *   it is a transient update (e.g. dragging an annotation; commit on release).
 */

export type ViewMode = 'editor' | 'grid';
/** A long-running document operation that must not be re-entered. */
export type BusyState = 'saving' | 'importing' | null;

const HISTORY_LIMIT = 200;

interface Snapshot {
  pages: PageRef[];
}

export interface EditorState {
  sources: Record<SourceId, SourceDoc>;
  pages: PageRef[];
  /** Pages highlighted in the grid/list. */
  selectedPageIds: PageId[];
  /** Page shown in the page editor. */
  activePageId: PageId | null;
  selectedAnnotationId: AnnotationId | null;
  tool: Tool;
  toolSettings: ToolSettings;
  viewMode: ViewMode;
  /** Editor zoom as a multiplier on "fit to width". 1 = fit. */
  zoom: number;
  /** Last signature chosen in the signature dialog (PNG data URL). */
  currentSignature: { dataUrl: string; width: number; height: number } | null;
  /** Suggested output file name (derived from the first imported file). */
  outputName: string;
  dirty: boolean;
  past: Snapshot[];
  future: Snapshot[];
  /** Non-fatal messages for the UI to display (toast). */
  notice: { id: string; kind: 'info' | 'error'; message: string } | null;
  /** Whether the signature picker dialog is open. */
  signatureDialogOpen: boolean;
  /** Set while a save or an import is running (guards re-entry, drives progress UI). */
  busy: BusyState;

  // ----- document -----
  /** Add an imported source and append (or insert) all of its pages. Returns new page ids. */
  addSource: (source: SourceDoc, insertAt?: number) => PageId[];
  removePages: (ids: PageId[]) => void;
  /** Move the given pages (keeping their relative order) so they start at `toIndex` in the resulting list. */
  movePages: (ids: PageId[], toIndex: number) => void;
  /** dnd-kit friendly: move a single page from one index to another. */
  movePage: (fromIndex: number, toIndex: number) => void;
  rotatePages: (ids: PageId[], delta: 90 | -90 | 180) => void;
  duplicatePages: (ids: PageId[]) => void;
  clearDocument: () => void;
  setOutputName: (name: string) => void;

  // ----- annotations -----
  addAnnotation: (pageId: PageId, annotation: Annotation) => void;
  /** Patch an annotation. `record=false` for transient updates (dragging). */
  updateAnnotation: (pageId: PageId, id: AnnotationId, patch: Partial<Annotation>, record?: boolean) => void;
  /** Replace an annotation wholesale (same id). */
  replaceAnnotation: (pageId: PageId, annotation: Annotation, record?: boolean) => void;
  removeAnnotation: (pageId: PageId, id: AnnotationId) => void;
  /** Record the current pages as an undo point (use before a transient drag sequence). */
  commitHistory: () => void;

  // ----- history -----
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // ----- ui -----
  setTool: (tool: Tool) => void;
  setToolSettings: (patch: Partial<ToolSettings>) => void;
  selectPages: (ids: PageId[]) => void;
  togglePageSelection: (id: PageId, additive: boolean) => void;
  setActivePage: (id: PageId | null) => void;
  selectAnnotation: (id: AnnotationId | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setZoom: (zoom: number) => void;
  setCurrentSignature: (sig: EditorState['currentSignature']) => void;
  markSaved: () => void;
  notify: (kind: 'info' | 'error', message: string) => void;
  clearNotice: () => void;
  setSignatureDialogOpen: (open: boolean) => void;
  setBusy: (busy: BusyState) => void;
}

function clonePages(pages: PageRef[]): PageRef[] {
  // Annotations are treated as immutable values; a shallow copy of the page
  // objects and their annotation arrays is enough for history snapshots.
  return pages.map((p) => ({ ...p, annotations: [...p.annotations] }));
}

function withHistory(state: EditorState, pages: PageRef[]): Partial<EditorState> {
  const past = [...state.past, { pages: clonePages(state.pages) }];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { pages, past, future: [], dirty: true };
}

function pickActive(pages: PageRef[], active: PageId | null, removed: Set<PageId>, oldPages: PageRef[]): PageId | null {
  if (active && !removed.has(active)) return active;
  if (pages.length === 0) return null;
  // choose the page that followed the removed active page, else the last one
  if (active) {
    const oldIdx = oldPages.findIndex((p) => p.id === active);
    for (let i = oldIdx + 1; i < oldPages.length; i++) {
      const cand = oldPages[i]!;
      if (!removed.has(cand.id)) return cand.id;
    }
  }
  return pages[pages.length - 1]!.id;
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  sources: {},
  pages: [],
  selectedPageIds: [],
  activePageId: null,
  selectedAnnotationId: null,
  tool: 'select',
  toolSettings: DEFAULT_TOOL_SETTINGS,
  viewMode: 'editor',
  zoom: 1,
  currentSignature: null,
  outputName: 'document.pdf',
  dirty: false,
  past: [],
  future: [],
  notice: null,
  signatureDialogOpen: false,
  busy: null,

  addSource: (source, insertAt) => {
    const newPages: PageRef[] = [];
    for (let i = 0; i < source.pageCount; i++) {
      newPages.push({ id: newId('p'), sourceId: source.id, sourceIndex: i, rotation: 0, annotations: [] });
    }
    set((state) => {
      const pages = [...state.pages];
      const at = insertAt === undefined ? pages.length : Math.max(0, Math.min(insertAt, pages.length));
      pages.splice(at, 0, ...newPages);
      // An import into an empty document names the output (also after every
      // page was deleted: the old name belonged to pages that are gone).
      const first = state.pages.length === 0;
      const outputName = first ? suggestOutputName(source.name) : state.outputName;
      // The very first import is not undoable: there is nothing to go back to.
      // When pages were deleted first, keep the history so undo can bring them back.
      const fresh = first && state.past.length === 0;
      const history = fresh ? { pages, past: [], future: [], dirty: true } : withHistory(state, pages);
      return {
        ...history,
        sources: { ...state.sources, [source.id]: source },
        activePageId: state.activePageId ?? newPages[0]?.id ?? null,
        outputName,
      };
    });
    return newPages.map((p) => p.id);
  },

  removePages: (ids) => {
    if (ids.length === 0) return;
    const removed = new Set(ids);
    set((state) => {
      const pages = state.pages.filter((p) => !removed.has(p.id));
      if (pages.length === state.pages.length) return {};
      return {
        ...withHistory(state, pages),
        // Nothing is left to lose once every page is gone (undo marks dirty again).
        ...(pages.length === 0 ? { dirty: false } : {}),
        selectedPageIds: state.selectedPageIds.filter((id) => !removed.has(id)),
        activePageId: pickActive(pages, state.activePageId, removed, state.pages),
        selectedAnnotationId: null,
      };
    });
  },

  movePages: (ids, toIndex) => {
    if (ids.length === 0) return;
    const moving = new Set(ids);
    set((state) => {
      const movingPages = state.pages.filter((p) => moving.has(p.id));
      if (movingPages.length === 0) return {};
      const rest = state.pages.filter((p) => !moving.has(p.id));
      // toIndex refers to a position in the *original* list; translate to `rest`.
      let target = 0;
      for (let i = 0; i < Math.min(toIndex, state.pages.length); i++) {
        if (!moving.has(state.pages[i]!.id)) target++;
      }
      const pages = [...rest];
      pages.splice(target, 0, ...movingPages);
      if (pages.every((p, i) => p.id === state.pages[i]!.id)) return {};
      return withHistory(state, pages);
    });
  },

  movePage: (fromIndex, toIndex) => {
    set((state) => {
      if (fromIndex === toIndex) return {};
      if (fromIndex < 0 || fromIndex >= state.pages.length) return {};
      const pages = [...state.pages];
      const [page] = pages.splice(fromIndex, 1);
      const clamped = Math.max(0, Math.min(toIndex, pages.length));
      pages.splice(clamped, 0, page!);
      return withHistory(state, pages);
    });
  },

  rotatePages: (ids, delta) => {
    if (ids.length === 0) return;
    const target = new Set(ids);
    set((state) => {
      const pages = state.pages.map((p) => {
        if (!target.has(p.id)) return p;
        const source = state.sources[p.sourceId];
        let annotations = p.annotations;
        if (source && annotations.length) {
          // keep annotations attached to the content they were drawn on
          const g = getPageGeometry(p, source);
          annotations = annotations.map((a) => rotateAnnotation(a, delta, g.displayWidth, g.displayHeight));
        }
        return { ...p, rotation: addRotation(p.rotation, delta) as Rotation, annotations };
      });
      return withHistory(state, pages);
    });
  },

  duplicatePages: (ids) => {
    if (ids.length === 0) return;
    const target = new Set(ids);
    set((state) => {
      const pages: PageRef[] = [];
      const newIds: PageId[] = [];
      for (const p of state.pages) {
        pages.push(p);
        if (target.has(p.id)) {
          const copy: PageRef = {
            ...p,
            id: newId('p'),
            annotations: p.annotations.map((a) => ({ ...a, id: newId('a') })),
          };
          pages.push(copy);
          newIds.push(copy.id);
        }
      }
      return { ...withHistory(state, pages), selectedPageIds: newIds };
    });
  },

  clearDocument: () =>
    set({
      sources: {},
      pages: [],
      selectedPageIds: [],
      activePageId: null,
      selectedAnnotationId: null,
      past: [],
      future: [],
      dirty: false,
      outputName: 'document.pdf',
      tool: 'select',
      zoom: 1,
      viewMode: 'editor',
      signatureDialogOpen: false,
    }),

  setOutputName: (name) => set({ outputName: name }),

  addAnnotation: (pageId, annotation) =>
    set((state) => {
      const pages = state.pages.map((p) =>
        p.id === pageId ? { ...p, annotations: [...p.annotations, annotation] } : p,
      );
      return withHistory(state, pages);
    }),

  updateAnnotation: (pageId, id, patch, record = true) =>
    set((state) => {
      const pages = state.pages.map((p) =>
        p.id === pageId
          ? {
              ...p,
              annotations: p.annotations.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a)),
            }
          : p,
      );
      return record ? withHistory(state, pages) : { pages, dirty: true };
    }),

  replaceAnnotation: (pageId, annotation, record = true) =>
    set((state) => {
      const pages = state.pages.map((p) =>
        p.id === pageId
          ? { ...p, annotations: p.annotations.map((a) => (a.id === annotation.id ? annotation : a)) }
          : p,
      );
      return record ? withHistory(state, pages) : { pages, dirty: true };
    }),

  removeAnnotation: (pageId, id) =>
    set((state) => {
      const pages = state.pages.map((p) =>
        p.id === pageId ? { ...p, annotations: p.annotations.filter((a) => a.id !== id) } : p,
      );
      return {
        ...withHistory(state, pages),
        selectedAnnotationId: state.selectedAnnotationId === id ? null : state.selectedAnnotationId,
      };
    }),

  commitHistory: () =>
    set((state) => {
      const past = [...state.past, { pages: clonePages(state.pages) }];
      if (past.length > HISTORY_LIMIT) past.shift();
      return { past, future: [] };
    }),

  undo: () =>
    set((state) => {
      const prev = state.past[state.past.length - 1];
      if (!prev) return {};
      const past = state.past.slice(0, -1);
      const future = [{ pages: clonePages(state.pages) }, ...state.future];
      return {
        pages: prev.pages,
        past,
        future,
        dirty: true,
        selectedAnnotationId: null,
        activePageId: reconcileActive(prev.pages, state.activePageId, state.pages),
        selectedPageIds: state.selectedPageIds.filter((id) => prev.pages.some((p) => p.id === id)),
      };
    }),

  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (!next) return {};
      const future = state.future.slice(1);
      const past = [...state.past, { pages: clonePages(state.pages) }];
      return {
        pages: next.pages,
        past,
        future,
        dirty: true,
        selectedAnnotationId: null,
        activePageId: reconcileActive(next.pages, state.activePageId, state.pages),
        selectedPageIds: state.selectedPageIds.filter((id) => next.pages.some((p) => p.id === id)),
      };
    }),

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  setTool: (tool) => set({ tool, selectedAnnotationId: null }),
  setToolSettings: (patch) => set((s) => ({ toolSettings: { ...s.toolSettings, ...patch } })),
  selectPages: (ids) => set({ selectedPageIds: ids }),
  togglePageSelection: (id, additive) =>
    set((s) => {
      if (!additive) return { selectedPageIds: [id] };
      return s.selectedPageIds.includes(id)
        ? { selectedPageIds: s.selectedPageIds.filter((x) => x !== id) }
        : { selectedPageIds: [...s.selectedPageIds, id] };
    }),
  setActivePage: (id) => set({ activePageId: id, selectedAnnotationId: null }),
  selectAnnotation: (id) => set({ selectedAnnotationId: id }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setZoom: (zoom) => set({ zoom: Math.min(4, Math.max(0.25, zoom)) }),
  setCurrentSignature: (sig) => set({ currentSignature: sig }),
  markSaved: () => set({ dirty: false }),
  notify: (kind, message) => set({ notice: { id: newId('n'), kind, message } }),
  clearNotice: () => set({ notice: null }),
  setSignatureDialogOpen: (open) => set({ signatureDialogOpen: open }),
  setBusy: (busy) => set({ busy }),
}));

/**
 * Active page after undo/redo: keep it when it still exists, otherwise stay
 * at the same position in the restored list (clamped) so the user does not
 * jump back to page 1 after undoing an insert or redoing a delete.
 */
function reconcileActive(pages: PageRef[], active: PageId | null, oldPages: PageRef[]): PageId | null {
  if (active && pages.some((p) => p.id === active)) return active;
  if (pages.length === 0) return null;
  const oldIdx = active ? oldPages.findIndex((p) => p.id === active) : -1;
  return pages[oldIdx < 0 ? 0 : Math.min(oldIdx, pages.length - 1)]!.id;
}

export function suggestOutputName(sourceName: string): string {
  const base = sourceName.replace(/\.[^.]+$/, '') || 'document';
  return `${base}-edited.pdf`;
}

// ----- selectors -----

export function selectActivePage(state: EditorState): PageRef | null {
  return state.pages.find((p) => p.id === state.activePageId) ?? null;
}

export function selectPageIndex(state: EditorState, id: PageId): number {
  return state.pages.findIndex((p) => p.id === id);
}
