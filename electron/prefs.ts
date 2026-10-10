/**
 * Tiny persisted preferences store: one JSON file under `userData`.
 * Holds the last window geometry and the last directory used in a dialog.
 * Reads are cached; writes are synchronous so they survive `close`/`quit`.
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

export interface Prefs {
  window?: WindowState;
  lastDir?: string;
}

export const PREFS_FILE_NAME = 'preferences.json';

let cache: Prefs | null = null;

export function prefsFilePath(): string {
  return path.join(app.getPath('userData'), PREFS_FILE_NAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readPrefs(): Prefs {
  if (cache) return cache;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(prefsFilePath(), 'utf8'));
    cache = isRecord(parsed) ? (parsed as Prefs) : {};
  } catch {
    cache = {};
  }
  return cache;
}

export function writePrefs(patch: Partial<Prefs>): void {
  const next: Prefs = { ...readPrefs(), ...patch };
  cache = next;
  const file = prefsFilePath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2));
  } catch (err) {
    console.error(`[prefs] could not write ${file}:`, err);
  }
}
