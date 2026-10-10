/**
 * Pointer-event state machine behind the annotation overlay.
 *
 * One pointer at a time drives an `Interaction` kept in a ref (no re-render
 * per move). Live pen/rect previews are written straight into two SVG
 * elements; moves and resizes go through the store as transient updates
 * (`record=false`) after a single `commitHistory()`, so a whole drag is one
 * undo step. All geometry is display space (points, origin bottom-left).
 */
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type {
  Annotation,
  AnnotationId,
  ImageAnnotation,
  PageGeometry,
  PageRef,
  Point,
  RectAnnotation,
  TextAnnotation,
} from '@/core/types';
import { canvasToDisplay, rectFromPoints } from '@/core/geometry';
import type { Rect } from '@/core/geometry';
import { rgbToCss } from '@/core/color';
import { useEditorStore } from '@/state/store';
import { annotationBounds, hitTest } from './hit-test';
import { measureTextWidth } from './measure';
import { appendStrokePoint } from './tools/stroke';
import { strokePathData, toSvgRect } from './tools/svg';
import {
  MIN_RECT_SIZE,
  clampPointToPage,
  clampTranslation,
  makeImageAnnotation,
  makeInkAnnotation,
  makeRectAnnotation,
  makeTextAnnotation,
  rectFromDrag,
  signaturePlacement,
  translateAnnotation,
} from './tools/shapes';
import type { InkTool, RectTool } from './tools/shapes';
import { HANDLE_SIZE_PX, cornerPoint, hitCorner, resizeBox } from './tools/resize';
import type { Corner } from './tools/resize';
import { NO_HOVER, cursorFor } from './tools/cursor';
import type { ActiveInteraction, EditorCursor, HoverState } from './tools/cursor';
import { planTextCommit } from './tools/text-edit';
import { isStaleInteraction } from './tools/pointer';
import type { TextEditSession } from './TextEditorOverlay';

/** Pointer travel (CSS px) before a press on an annotation becomes a move. */
export const DRAG_THRESHOLD_PX = 3;
/** Pointer travel (CSS px) beyond which a text/signature click is cancelled. */
export const CLICK_SLOP_PX = 6;

type Interaction =
  | { kind: 'ink'; pointerId: number; mode: InkTool; points: Point[] }
  | { kind: 'rect'; pointerId: number; mode: RectTool; start: Point; current: Point }
  | {
      kind: 'move';
      pointerId: number;
      id: AnnotationId;
      original: Annotation;
      bounds: Rect;
      start: Point;
      moved: boolean;
      lastPatch: Partial<Annotation> | null;
    }
  | {
      kind: 'resize';
      pointerId: number;
      id: AnnotationId;
      original: RectAnnotation | ImageAnnotation;
      corner: Corner;
      /** Pointer position at pointerdown (display space). */
      start: Point;
      /** Corner minus pointerdown position: keeps the grab point fixed under the pointer while resizing. */
      offset: Point;
      moved: boolean;
      lastPatch: Rect | null;
    }
  | {
      kind: 'click';
      pointerId: number;
      tool: 'text' | 'signature';
      start: Point;
      startClient: Point;
      existingText: TextAnnotation | null;
    }
  | { kind: 'consumed'; pointerId: number };

interface ActiveState {
  kind: ActiveInteraction;
  corner: Corner | null;
}

export interface EditorInteractionArgs {
  page: PageRef;
  geometry: PageGeometry;
  scale: number;
  svgRef: RefObject<SVGSVGElement | null>;
}

export interface OverlayHandlers {
  onPointerDown: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerMove: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerUp: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onLostPointerCapture: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerLeave: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onDoubleClick: (e: ReactMouseEvent<SVGSVGElement>) => void;
}

export interface EditorInteractions {
  handlers: OverlayHandlers;
  cursor: EditorCursor;
  editing: TextEditSession | null;
  setEditText: (text: string) => void;
  commitEdit: () => void;
  inkPreviewRef: RefObject<SVGPathElement | null>;
  rectPreviewRef: RefObject<SVGRectElement | null>;
}

function isResizable(a: Annotation | undefined): a is RectAnnotation | ImageAnnotation {
  return a !== undefined && (a.type === 'rect' || a.type === 'image');
}

export function useEditorInteractions({ page, geometry, scale, svgRef }: EditorInteractionArgs): EditorInteractions {
  const tool = useEditorStore((s) => s.tool);
  const toolSettings = useEditorStore((s) => s.toolSettings);
  const selectedId = useEditorStore((s) => s.selectedAnnotationId);

  const inkPreviewRef = useRef<SVGPathElement>(null);
  const rectPreviewRef = useRef<SVGRectElement>(null);
  const interaction = useRef<Interaction | null>(null);
  const editingRef = useRef<TextEditSession | null>(null);
  const [editing, setEditingState] = useState<TextEditSession | null>(null);
  const [hover, setHover] = useState<HoverState>(NO_HOVER);
  const [active, setActive] = useState<ActiveState | null>(null);

  // ----- helpers -----

  const toDisplay = (clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    const effectiveScale = r.width > 0 ? r.width / geometry.displayWidth : scale;
    return canvasToDisplay({ x: clientX - r.left, y: clientY - r.top }, geometry, effectiveScale);
  };

  const capture = (pointerId: number) => {
    try {
      svgRef.current?.setPointerCapture(pointerId);
    } catch {
      /* pointer already gone */
    }
  };

  const release = (pointerId: number) => {
    const svg = svgRef.current;
    try {
      if (svg?.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId);
    } catch {
      /* ignore */
    }
  };

  const selectedAnnotation = () => (selectedId ? page.annotations.find((a) => a.id === selectedId) : undefined);

  const hitAll = (p: Point) => hitTest(page.annotations, p, { measure: measureTextWidth });

  const hitText = (p: Point): TextAnnotation | null => {
    const hit = hitTest(
      page.annotations.filter((a) => a.type === 'text'),
      p,
      { measure: measureTextWidth },
    );
    return hit && hit.type === 'text' ? hit : null;
  };

  const cornerUnder = (p: Point): Corner | null => {
    const selected = selectedAnnotation();
    if (!isResizable(selected)) return null;
    return hitCorner(annotationBounds(selected), p, HANDLE_SIZE_PX / scale);
  };

  // ----- live previews (imperative, no React re-render per pointer move) -----

  const beginInkPreview = (mode: InkTool, points: Point[]) => {
    const el = inkPreviewRef.current;
    if (!el) return;
    const style = makeInkAnnotation(mode, [], toolSettings, 'preview');
    el.setAttribute('stroke', rgbToCss(style.color));
    el.setAttribute('stroke-width', String(style.strokeWidth));
    el.setAttribute('opacity', String(style.opacity));
    el.classList.toggle('blend-multiply', style.blendMode === 'Multiply');
    el.setAttribute('d', strokePathData(points, geometry.displayHeight));
  };

  const updateInkPreview = (points: Point[]) => {
    inkPreviewRef.current?.setAttribute('d', strokePathData(points, geometry.displayHeight));
  };

  const showRectPreview = (mode: RectTool, start: Point, current: Point) => {
    const el = rectPreviewRef.current;
    if (!el) return;
    const r = rectFromPoints(start, current);
    const style = makeRectAnnotation(mode, r, toolSettings, 'preview');
    const svgRect = toSvgRect(r, geometry.displayHeight);
    el.setAttribute('x', String(svgRect.x));
    el.setAttribute('y', String(svgRect.y));
    el.setAttribute('width', String(svgRect.width));
    el.setAttribute('height', String(svgRect.height));
    el.setAttribute('fill', style.fillColor ? rgbToCss(style.fillColor) : 'none');
    el.setAttribute('stroke', style.strokeColor ? rgbToCss(style.strokeColor) : 'none');
    el.setAttribute('stroke-width', String(style.strokeWidth));
    el.setAttribute('opacity', String(style.opacity));
    el.classList.toggle('blend-multiply', style.blendMode === 'Multiply');
    el.dataset.mode = mode;
  };

  const clearPreviews = () => {
    inkPreviewRef.current?.setAttribute('d', '');
    const r = rectPreviewRef.current;
    if (r) {
      r.setAttribute('width', '0');
      r.setAttribute('height', '0');
      delete r.dataset.mode;
    }
  };

  // ----- inline text editing -----

  const setEditing = (session: TextEditSession | null) => {
    editingRef.current = session;
    setEditingState(session);
  };

  const beginEdit = (annotation: TextAnnotation, isNew: boolean) => {
    const store = useEditorStore.getState();
    if (!isNew && store.selectedAnnotationId !== annotation.id) store.selectAnnotation(annotation.id);
    setEditing({ pageId: page.id, annotation, isNew, text: annotation.text });
  };

  const setEditText = (text: string) => {
    const session = editingRef.current;
    if (!session) return;
    setEditing({ ...session, text });
  };

  /** Close the editor and write the result to the store. Safe to call twice. */
  const commitEdit = () => {
    const session = editingRef.current;
    if (!session) return;
    setEditing(null);
    const store = useEditorStore.getState();
    const id = session.annotation.id;
    const plan = planTextCommit(session.isNew, session.annotation.text, session.text);
    switch (plan) {
      case 'add':
        store.addAnnotation(session.pageId, { ...session.annotation, text: session.text });
        break;
      case 'update':
        store.updateAnnotation(session.pageId, id, { text: session.text }, true);
        break;
      case 'remove':
        store.removeAnnotation(session.pageId, id);
        break;
      case 'none':
        break;
    }
    if (session.isNew) {
      // Back to the select tool with the new annotation selected.
      if (store.tool !== 'select') store.setTool('select');
      if (plan === 'add') store.selectAnnotation(id);
    } else if (plan !== 'remove') {
      store.selectAnnotation(id);
    }
  };

  const commitRef = useRef(commitEdit);
  commitRef.current = commitEdit;

  // The active page changed under an open editor (e.g. sidebar navigation): commit to the old page.
  useEffect(() => {
    const session = editingRef.current;
    if (session && session.pageId !== page.id) commitRef.current();
  }, [page.id]);

  // Never lose typed text when the layer unmounts (view toggle, document cleared).
  useEffect(() => () => commitRef.current(), []);

  // ----- pointer handlers -----

  const updateHover = (p: Point) => {
    const corner = cornerUnder(p);
    const id = corner ? selectedId : (hitAll(p)?.id ?? null);
    setHover((prev) => (prev.id === id && prev.corner === corner ? prev : { id, corner }));
  };

  /** Close the current interaction (pointerup, cancel or lost capture) and apply its result. */
  const finish = (pointerId: number, cancelled: boolean) => {
    const it = interaction.current;
    if (!it || it.pointerId !== pointerId) return;
    interaction.current = null;
    setActive(null);
    release(pointerId);
    const store = useEditorStore.getState();

    switch (it.kind) {
      case 'ink':
        clearPreviews();
        if (!cancelled) store.addAnnotation(page.id, makeInkAnnotation(it.mode, it.points, toolSettings));
        return;
      case 'rect': {
        clearPreviews();
        if (cancelled) return;
        const r = rectFromDrag(it.start, it.current, geometry);
        if (r) store.addAnnotation(page.id, makeRectAnnotation(it.mode, r, toolSettings));
        return;
      }
      case 'move':
      case 'resize':
        // Final transient update; the undo point was recorded when the drag started.
        if (it.moved && it.lastPatch) store.updateAnnotation(page.id, it.id, it.lastPatch, false);
        return;
      case 'click': {
        if (cancelled) return;
        if (it.tool === 'text') {
          if (it.existingText) beginEdit(it.existingText, false);
          else beginEdit(makeTextAnnotation(it.start, toolSettings), true);
          return;
        }
        const signature = store.currentSignature;
        if (!signature) {
          // The Toolbar/Signature module owns the dialog and sets currentSignature.
          store.setSignatureDialogOpen(true);
          return;
        }
        const image = makeImageAnnotation(signaturePlacement(it.start, signature, geometry), signature.dataUrl);
        store.addAnnotation(page.id, image);
        store.setTool('select');
        store.selectAnnotation(image.id);
        return;
      }
      case 'consumed':
        return;
    }
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (interaction.current) {
      // A second finger/pen while one is drawing: ignore it. The same pointer
      // (or a mouse) pressing again means we never saw the previous pointerup,
      // so close that interaction instead of ignoring input forever: keep what
      // was drawn/moved, but do not act on a stale click (this press is the click).
      const stale = interaction.current;
      if (!isStaleInteraction(stale.pointerId, e)) return;
      finish(stale.pointerId, stale.kind === 'click');
    }

    if (editingRef.current) {
      // Clicking the page while typing just closes the editor.
      commitEdit();
      interaction.current = { kind: 'consumed', pointerId: e.pointerId };
      capture(e.pointerId);
      return;
    }

    const p = toDisplay(e.clientX, e.clientY);
    const store = useEditorStore.getState();

    switch (tool) {
      case 'select': {
        const selected = selectedAnnotation();
        if (isResizable(selected)) {
          const bounds = annotationBounds(selected);
          const corner = hitCorner(bounds, p, HANDLE_SIZE_PX / scale);
          if (corner) {
            const c = cornerPoint(bounds, corner);
            interaction.current = {
              kind: 'resize',
              pointerId: e.pointerId,
              id: selected.id,
              original: selected,
              corner,
              start: p,
              offset: { x: c.x - p.x, y: c.y - p.y },
              moved: false,
              lastPatch: null,
            };
            capture(e.pointerId);
            setActive({ kind: 'resize', corner });
            return;
          }
        }
        const hit = hitAll(p);
        if (!hit) {
          if (selectedId) store.selectAnnotation(null);
          interaction.current = { kind: 'consumed', pointerId: e.pointerId };
          capture(e.pointerId);
          return;
        }
        if (hit.id !== selectedId) store.selectAnnotation(hit.id);
        interaction.current = {
          kind: 'move',
          pointerId: e.pointerId,
          id: hit.id,
          original: hit,
          bounds: annotationBounds(hit, measureTextWidth),
          start: p,
          moved: false,
          lastPatch: null,
        };
        capture(e.pointerId);
        return;
      }
      case 'text':
      case 'signature': {
        interaction.current = {
          kind: 'click',
          pointerId: e.pointerId,
          tool,
          start: p,
          startClient: { x: e.clientX, y: e.clientY },
          existingText: tool === 'text' ? hitText(p) : null,
        };
        capture(e.pointerId);
        return;
      }
      case 'pen':
      case 'highlighter': {
        const points: Point[] = [{ x: p.x, y: p.y }];
        interaction.current = { kind: 'ink', pointerId: e.pointerId, mode: tool, points };
        capture(e.pointerId);
        beginInkPreview(tool, points);
        setActive({ kind: 'ink', corner: null });
        return;
      }
      case 'rect':
      case 'highlight-box':
      case 'whiteout': {
        const start = clampPointToPage(p, geometry);
        interaction.current = { kind: 'rect', pointerId: e.pointerId, mode: tool, start, current: start };
        capture(e.pointerId);
        showRectPreview(tool, start, start);
        setActive({ kind: 'rect', corner: null });
        return;
      }
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const it = interaction.current;
    if (!it) {
      if (tool === 'select') updateHover(toDisplay(e.clientX, e.clientY));
      return;
    }
    if (it.pointerId !== e.pointerId) return;
    const store = useEditorStore.getState();

    switch (it.kind) {
      case 'ink': {
        const native = e.nativeEvent;
        const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
        const events: { clientX: number; clientY: number }[] = coalesced.length > 0 ? coalesced : [native];
        for (const ev of events) appendStrokePoint(it.points, toDisplay(ev.clientX, ev.clientY));
        updateInkPreview(it.points);
        return;
      }
      case 'rect': {
        it.current = clampPointToPage(toDisplay(e.clientX, e.clientY), geometry);
        showRectPreview(it.mode, it.start, it.current);
        return;
      }
      case 'move': {
        const p = toDisplay(e.clientX, e.clientY);
        const dx = p.x - it.start.x;
        const dy = p.y - it.start.y;
        if (!it.moved) {
          if (Math.hypot(dx, dy) * scale < DRAG_THRESHOLD_PX) return;
          it.moved = true;
          store.commitHistory(); // the one undo point for this drag
          setActive({ kind: 'move', corner: null });
        }
        const d = clampTranslation(it.bounds, dx, dy, geometry);
        it.lastPatch = translateAnnotation(it.original, d.x, d.y);
        store.updateAnnotation(page.id, it.id, it.lastPatch, false);
        return;
      }
      case 'resize': {
        const p = toDisplay(e.clientX, e.clientY);
        if (!it.moved) {
          // Same threshold as a move: a press-and-release (or pointer jitter) on a handle is not a resize.
          if (Math.hypot(p.x - it.start.x, p.y - it.start.y) * scale < DRAG_THRESHOLD_PX) return;
          it.moved = true;
          store.commitHistory(); // the one undo point for this resize
        }
        const target = clampPointToPage({ x: p.x + it.offset.x, y: p.y + it.offset.y }, geometry);
        const box = resizeBox(annotationBounds(it.original), it.corner, target, {
          keepAspect: it.original.type === 'image',
          minSize: MIN_RECT_SIZE,
        });
        it.lastPatch = box;
        store.updateAnnotation(page.id, it.id, box, false);
        return;
      }
      case 'click': {
        const travel = Math.hypot(e.clientX - it.startClient.x, e.clientY - it.startClient.y);
        if (travel > CLICK_SLOP_PX) interaction.current = { kind: 'consumed', pointerId: it.pointerId };
        return;
      }
      case 'consumed':
        return;
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => finish(e.pointerId, false);
  // The browser took the pointer away (palm rejection, system gesture): drop the gesture.
  const onPointerCancel = (e: ReactPointerEvent<SVGSVGElement>) => finish(e.pointerId, true);
  // After a normal pointerup the interaction is already closed and this is a no-op. It only
  // does something when capture vanished mid-gesture; keep what the user drew rather than losing it.
  const onLostPointerCapture = (e: ReactPointerEvent<SVGSVGElement>) => finish(e.pointerId, false);

  const onPointerLeave = () => {
    if (!interaction.current) setHover(NO_HOVER);
  };

  const onDoubleClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (tool !== 'select' || editingRef.current) return;
    const hit = hitAll(toDisplay(e.clientX, e.clientY));
    if (hit?.type === 'text') beginEdit(hit, false);
  };

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture, onPointerLeave, onDoubleClick },
    cursor: cursorFor(tool, active?.kind ?? null, active?.corner ?? null, hover, selectedId),
    editing,
    setEditText,
    commitEdit,
    inkPreviewRef,
    rectPreviewRef,
  };
}
