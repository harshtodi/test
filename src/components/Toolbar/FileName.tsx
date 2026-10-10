import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '@/state/store';
import { normalizeOutputName } from './helpers';
import { PencilIcon } from './icons';

/**
 * The output file name. Shown as text (`tb-filename`); clicking it turns it
 * into an input (`tb-filename-input`). Enter/blur commits (always ending in
 * `.pdf`), Escape cancels.
 */
export function FileName() {
  const outputName = useEditorStore((s) => s.outputName);
  const setOutputName = useEditorStore((s) => s.setOutputName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(outputName);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cancelledRef = useRef(false);
  /** Set by Enter/Escape so focus returns to the button (a blur caused by clicking elsewhere must not steal focus). */
  const restoreFocusRef = useRef(false);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // select the base name, leave the extension alone
    const dot = el.value.toLowerCase().lastIndexOf('.pdf');
    el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
  }, [editing]);

  useEffect(() => {
    if (editing || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    buttonRef.current?.focus();
  }, [editing]);

  const start = () => {
    cancelledRef.current = false;
    setDraft(outputName);
    setEditing(true);
  };

  const commit = () => {
    if (!cancelledRef.current) {
      const next = normalizeOutputName(draft, outputName);
      if (next !== outputName) setOutputName(next);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="tb-filename-input"
        data-testid="tb-filename-input"
        value={draft}
        aria-label="Output file name"
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            restoreFocusRef.current = true;
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancelledRef.current = true;
            restoreFocusRef.current = true;
            setEditing(false);
          } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            // Save while renaming: commit the draft first. The store update is
            // synchronous and React's root handler runs before the window-level
            // Ctrl+S shortcut, so the save already sees the new name. No
            // preventDefault here: the global handler owns that.
            restoreFocusRef.current = true;
            commit();
          }
        }}
      />
    );
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      className="tb-filename"
      data-testid="tb-filename"
      title="Output file name (click to rename)"
      aria-label={`Output file name: ${outputName}. Click to rename`}
      onClick={start}
    >
      <span className="tb-filename-text">{outputName}</span>
      <PencilIcon />
    </button>
  );
}
