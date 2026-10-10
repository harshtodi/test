import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface MenuItem {
  id: string;
  label: ReactNode;
  testId: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

/**
 * A small dropdown behind a "more" button. Closes on outside click, Escape,
 * Tab (focus continues from the toggle button), or after an item is selected.
 * Arrow keys move between items.
 */
export function OverflowMenu({ items, children, label, testId }: { items: MenuItem[]; children: ReactNode; label: string; testId: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    // focus the first enabled item
    const first = menuRef.current?.querySelector<HTMLElement>('[role=menuitem]:not([disabled])');
    first?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const moveFocus = (delta: number) => {
    const els = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])') ?? []);
    if (els.length === 0) return;
    const idx = els.findIndex((el) => el === document.activeElement);
    const next = els[(idx + delta + els.length) % els.length];
    next?.focus();
  };

  return (
    <div className="tb-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`btn btn-icon${open ? ' active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
      >
        {children}
      </button>
      {open && (
        <div
          ref={menuRef}
          className="tb-menu-dropdown"
          role="menu"
          aria-label={label}
          data-testid={`${testId}-dropdown`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              moveFocus(1);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              moveFocus(-1);
            } else if (e.key === 'Tab') {
              // Leaving with the keyboard closes the menu. Focus is moved to the
              // toggle synchronously (no preventDefault), so the browser's own
              // Tab / Shift+Tab continues from there to the next / previous control.
              setOpen(false);
              buttonRef.current?.focus();
            }
          }}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={`tb-menu-item${item.danger ? ' danger' : ''}`}
              data-testid={item.testId}
              disabled={item.disabled}
              // Roving focus (open → first item, arrows): items are not in the Tab order.
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                // the item is about to unmount: hand focus back to the toggle
                buttonRef.current?.focus();
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
