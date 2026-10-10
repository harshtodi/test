import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useEditorStore } from '@/state/store';
import { DrawPad } from './DrawPad';
import { TypePad } from './TypePad';
import { UploadPad } from './UploadPad';
import { SavedSignatures } from './SavedSignatures';
import { trimCanvas } from './signature-image';
import { getLocalStorage, loadSignatures, removeSignature, saveSignature } from './signature-store';
import type { SavedSignature, SignatureImage } from './signature-store';
import './SignatureDialog.css';

type Tab = 'draw' | 'type' | 'upload';

const TABS: { id: Tab; label: string }[] = [
  { id: 'draw', label: 'Draw' },
  { id: 'type', label: 'Type' },
  { id: 'upload', label: 'Upload' },
];

/** Padding around the ink in the exported PNG (CSS pixels). */
const TRIM_PADDING = 8;

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/**
 * Modal for creating or picking a signature. Open state lives in the store
 * (`signatureDialogOpen`). On "Use signature" the drawing is trimmed to a
 * transparent PNG, stored as `currentSignature`, the signature tool is
 * selected, the image is remembered in localStorage, and the dialog closes.
 */
export function SignatureDialog() {
  const open = useEditorStore((s) => s.signatureDialogOpen);
  if (!open) return null;
  return createPortal(<SignatureDialogBody />, document.body);
}

function SignatureDialogBody() {
  const setOpen = useEditorStore((s) => s.setSignatureDialogOpen);
  const setCurrentSignature = useEditorStore((s) => s.setCurrentSignature);
  const setTool = useEditorStore((s) => s.setTool);
  const [tab, setTab] = useState<Tab>('draw');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedSignature[]>(() => loadSignatures(getLocalStorage()));
  const [hasInk, setHasInk] = useState<Record<Tab, boolean>>({ draw: false, type: false, upload: false });
  const drawRef = useRef<HTMLCanvasElement | null>(null);
  const typeRef = useRef<HTMLCanvasElement | null>(null);
  const uploadRef = useRef<HTMLCanvasElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Focus management: remember the opener, focus the dialog, restore on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = dialogRef.current?.querySelector<HTMLElement>('[role=tab][aria-selected="true"]');
    (first ?? dialogRef.current)?.focus();
    return () => {
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  // Removing a saved signature unmounts the focused "×" button; without this,
  // focus falls to <body> and keystrokes bypass the dialog's stopPropagation
  // and reach the global shortcuts (e.g. Delete would remove an annotation).
  useEffect(() => {
    const root = dialogRef.current;
    if (root && !root.contains(document.activeElement)) root.focus();
  }, [saved]);

  const close = useCallback(() => setOpen(false), [setOpen]);

  const cancel = useCallback(() => {
    const s = useEditorStore.getState();
    // Nothing to place: do not leave the user holding an empty signature tool.
    if (s.tool === 'signature' && !s.currentSignature) s.setTool('select');
    close();
  }, [close]);

  const apply = useCallback(
    (img: SignatureImage, remember: boolean) => {
      setCurrentSignature({ dataUrl: img.dataUrl, width: img.width, height: img.height });
      setTool('signature');
      if (remember) setSaved(saveSignature(getLocalStorage(), img));
      close();
    },
    [setCurrentSignature, setTool, close],
  );

  const useSignature = () => {
    const canvas = tab === 'draw' ? drawRef.current : tab === 'type' ? typeRef.current : uploadRef.current;
    const dpr = tab === 'upload' ? 1 : Math.max(1, window.devicePixelRatio || 1);
    const img = canvas ? trimCanvas(canvas, TRIM_PADDING * dpr) : null;
    if (!img) {
      setError(
        tab === 'draw'
          ? 'Draw your signature first.'
          : tab === 'type'
            ? 'Type your name first.'
            : 'The chosen image has no visible content (try turning off the transparent background option).',
      );
      return;
    }
    setError(null);
    apply(img, true);
  };

  const onRemoveSaved = (id: string) => setSaved(removeSignature(getLocalStorage(), id));

  const onInk = useCallback((which: Tab, v: boolean) => {
    setHasInk((prev) => (prev[which] === v ? prev : { ...prev, [which]: v }));
    if (v) setError(null);
  }, []);
  const onDrawInk = useCallback((v: boolean) => onInk('draw', v), [onInk]);
  const onTypeInk = useCallback((v: boolean) => onInk('type', v), [onInk]);
  const onUploadInk = useCallback((v: boolean) => onInk('upload', v), [onInk]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // The dialog is modal: nothing typed here should reach the global shortcuts.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.key === 'Tab') {
      const root = dialogRef.current;
      if (!root) return;
      const els = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (els.length === 0) return;
      const first = els[0]!;
      const last = els[els.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const onTabKey = (e: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const t = TABS[next]!;
    setTab(t.id);
    dialogRef.current?.querySelector<HTMLElement>(`[data-testid="sig-tab-${t.id}"]`)?.focus();
  };

  const onBackdropPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Only a press that *starts* on the backdrop closes; a stroke that ends
    // outside the pad must not.
    if (e.target === e.currentTarget) cancel();
  };

  const canUse = hasInk[tab];

  return (
    <div className="sig-backdrop" data-testid="signature-backdrop" onPointerDown={onBackdropPointerDown}>
      <div
        ref={dialogRef}
        className="sig-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="signature-dialog"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="sig-header">
          <h2 id={titleId} className="sig-title">
            Signature
          </h2>
          <button type="button" className="btn btn-icon sig-close" aria-label="Close" title="Close (Esc)" data-testid="sig-close" onClick={cancel}>
            <CloseIcon />
          </button>
        </header>

        <div className="sig-tabs" role="tablist" aria-label="Signature source">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${titleId}-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`${titleId}-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className={`sig-tab${tab === t.id ? ' active' : ''}`}
              data-testid={`sig-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* All three pads stay mounted so switching tabs keeps their content; only the active one is shown. */}
        <div className="sig-panels">
          <div role="tabpanel" id={`${titleId}-panel-draw`} aria-labelledby={`${titleId}-tab-draw`} hidden={tab !== 'draw'} className="sig-panel">
            <DrawPad canvasRef={drawRef} onInkChange={onDrawInk} />
          </div>
          <div role="tabpanel" id={`${titleId}-panel-type`} aria-labelledby={`${titleId}-tab-type`} hidden={tab !== 'type'} className="sig-panel">
            {tab === 'type' || hasInk.type ? <TypePad canvasRef={typeRef} onInkChange={onTypeInk} /> : null}
          </div>
          <div role="tabpanel" id={`${titleId}-panel-upload`} aria-labelledby={`${titleId}-tab-upload`} hidden={tab !== 'upload'} className="sig-panel">
            <UploadPad canvasRef={uploadRef} onInkChange={onUploadInk} />
          </div>
        </div>

        {error && (
          <p className="sig-error" role="alert" data-testid="sig-error">
            {error}
          </p>
        )}

        <SavedSignatures signatures={saved} onPick={(sig) => apply(sig, false)} onRemove={onRemoveSaved} />

        <footer className="sig-footer">
          <span className="sig-footer-hint">Saved signatures stay on this computer only.</span>
          <button type="button" className="btn" data-testid="sig-cancel" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" data-testid="sig-use" disabled={!canUse} onClick={useSignature}>
            Use signature
          </button>
        </footer>
      </div>
    </div>
  );
}
