/**
 * Inline editor for a text annotation: a transparent, auto-sizing <textarea>
 * positioned over the canvas so what you type sits exactly where the SVG
 * preview (and the exported PDF) will put it.
 *
 * Commit: blur, Escape, or Ctrl/Cmd+Enter. Plain Enter inserts a newline.
 * Ctrl/Cmd+S commits too (without swallowing the key) so the global save
 * shortcut exports what was just typed.
 */
import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
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
      onBlur={onCommit}
    />
  );
}
