/**
 * Remember and restore the main window's size and position.
 * Saved bounds are validated against the current displays so a window never
 * reappears off-screen after a monitor is unplugged.
 */
import { screen } from 'electron';
import type { BrowserWindow, Rectangle } from 'electron';
import { readPrefs, writePrefs } from './prefs';
import type { WindowState } from './prefs';

export const DEFAULT_WINDOW_SIZE = { width: 1280, height: 860 } as const;
export const MIN_WINDOW_SIZE = { width: 900, height: 600 } as const;

/** Minimum number of pixels of the window that must be visible on some display. */
const VISIBLE_MARGIN = 100;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const v = isFiniteNumber(value) ? value : fallback;
  return Math.round(Math.min(Math.max(v, min), Math.max(min, max)));
}

/** True when at least VISIBLE_MARGIN px of the window's top edge falls inside `display`. */
function isVisibleOn(display: Rectangle, win: Rectangle): boolean {
  const overlapX = Math.min(display.x + display.width, win.x + win.width) - Math.max(display.x, win.x);
  const overlapY = Math.min(display.y + display.height, win.y + win.height) - Math.max(display.y, win.y);
  return overlapX >= Math.min(VISIBLE_MARGIN, win.width) && overlapY >= Math.min(VISIBLE_MARGIN, win.height);
}

/**
 * Pure: turn whatever was persisted into a safe window state for `displays`
 * (work areas). Sizes are clamped to [minimum, largest display]; the position
 * is kept only when the window would actually be visible.
 */
export function sanitizeWindowState(saved: unknown, displays: readonly Rectangle[]): WindowState {
  const s: Record<string, unknown> = isRecord(saved) ? saved : {};
  const maxWidth = displays.length ? Math.max(...displays.map((d) => d.width)) : Number.MAX_SAFE_INTEGER;
  const maxHeight = displays.length ? Math.max(...displays.map((d) => d.height)) : Number.MAX_SAFE_INTEGER;
  const width = clampInt(s.width, MIN_WINDOW_SIZE.width, maxWidth, DEFAULT_WINDOW_SIZE.width);
  const height = clampInt(s.height, MIN_WINDOW_SIZE.height, maxHeight, DEFAULT_WINDOW_SIZE.height);
  const state: WindowState = { width, height, maximized: s.maximized === true };
  if (isFiniteNumber(s.x) && isFiniteNumber(s.y)) {
    const candidate: Rectangle = { x: Math.round(s.x), y: Math.round(s.y), width, height };
    if (displays.some((d) => isVisibleOn(d, candidate))) {
      state.x = candidate.x;
      state.y = candidate.y;
    }
  }
  return state;
}

/** Load the persisted state, validated against the displays attached right now. */
export function loadWindowState(): WindowState {
  return sanitizeWindowState(
    readPrefs().window,
    screen.getAllDisplays().map((d) => d.workArea),
  );
}

export function captureWindowState(win: BrowserWindow): WindowState {
  const maximized = win.isMaximized();
  // A minimized window reports bogus bounds on Windows (-32000,-32000 and an
  // icon-sized rectangle); the normal bounds are what should be restored.
  const useNormal = maximized || win.isMinimized() || win.isFullScreen();
  const bounds = useNormal ? win.getNormalBounds() : win.getBounds();
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, maximized };
}

export function saveWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  writePrefs({ window: captureWindowState(win) });
}
