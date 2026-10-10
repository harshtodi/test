/**
 * Inline editor for a text annotation: a transparent, auto-sizing <textarea>
 * positioned over the canvas so what you type sits exactly where the SVG
 * preview (and the exported PDF) will put it.
 *
 * Commit: blur, Escape, or Ctrl/Cmd+Enter. Plain Enter inserts a newline.
 * Ctrl/Cmd+S commits too (without swallowing the key) so the global save
 * shortcut exports what was just typed. A blur caused by one of the toolbar's
 * text options (colour swatch, font, size) does not commit: those act on the
 * text being typed (useEditorInteractions restyles the session) and the
 * textarea takes focus back once the option has applied.
 */
import { useEffect, useRef } from 'react';
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { PageGeometry, PageId, TextAnnotation } from '@/core/types';
import { rgbToCss } from '@/core/color';
import { LINE_HEIGHT_RATIO, cssFontFamily, cssFontWeight } from '@/core/text-metrics';
import { cssBaselineRatio, measureTextWidth } from './measure';
import { textEditorFrame } from './tools/text-edit';

export interface TextEditSession {
  pageId: PageId;
  /** The annotation as it was when editing started (position, style, original text). */
  annotation: TextAnnotation;
  /** True while the annotation only exists in this session (not yet in the store). */
  isNew: boolean;
  /** Current editor contents. */
  text: string;
}

/** The Toolbar's context-sensitive options group (src/components/Toolbar/ToolOptions.tsx). */
const TOOL_OPTIONS_SELECTOR = '[data-testid="tool-options"]';

export interface TextEditorOverlayProps {
  session: TextEditSession;
  geometry: PageGeometry;
  scale: number;
  onChange: (text: string) => void;
  onCommit: () => void;
}

export function TextEditorOverlay({ session, geometry, scale, onChange, onCommit }: TextEditorOverlayProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const a = session.annotation;
  const frame = textEditorFrame(
    { x: a.x, y: a.y, fontSize: a.fontSize, font: a.font, text: session.text },
    geometry,
    scale,
    { baselineRatio: cssBaselineRatio(a.font), measureLine: measureTextWidth },
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  // A toolbar option restyled this text while it held focus (font / size <select>, or a swatch
  // whose refocus below has not landed yet): take focus back so typing continues. The custom
  // colour <input> keeps focus for its native dialog.
  useEffect(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active instanceof HTMLInputElement) return;
    if (active.closest(TOOL_OPTIONS_SELECTOR)) ref.current?.focus({ preventScroll: true });
  }, [a.font, a.fontSize, a.color]);

  const onBlur = (e: ReactFocusEvent<HTMLTextAreaElement>) => {
    const next = e.relatedTarget;
    if (next instanceof HTMLElement && next.closest(TOOL_OPTIONS_SELECTOR) && next.dataset.testid !== 'opt-delete-annotation') {
      // Focus moved to a text option on its mousedown: keep editing. A swatch button hands focus
      // straight back; a <select> / <input> keeps it until its value is applied (refocusing now
      // would close its popup) — the effect above handles that.
      if (next instanceof HTMLButtonElement) setTimeout(() => ref.current?.focus({ preventScroll: true }), 0);
      return;
    }
    onCommit();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape' || (e.key === 'Enter' && mod)) {
      e.preventDefault();
      onCommit();
      return;
    }
    // The store is updated synchronously, so the window-level Ctrl+S handler
    // that runs next saves a document that already contains this text.
    if (mod && e.key.toLowerCase() === 's') onCommit();
  };

  const color = rgbToCss(a.color);
  return (
    <textarea
      ref={ref}
      className="text-editor-input"
      data-testid="text-editor-input"
      data-annotation-id={a.id}
      aria-label="Text annotation"
      value={session.text}
      rows={1}
      wrap="off"
      spellCheck={false}
      autoCapitalize="off"
      style={{
        left: frame.left,
        top: frame.top,
        width: frame.width,
        height: frame.height,
        fontSize: frame.fontSizePx,
        lineHeight: LINE_HEIGHT_RATIO,
        fontFamily: cssFontFamily(a.font),
        fontWeight: cssFontWeight(a.font),
        color,
        caretColor: color,
      }}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    />
  );
}
