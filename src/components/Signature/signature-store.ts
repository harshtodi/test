/**
 * Saved signatures, persisted in localStorage so a user can re-use them
 * across documents and sessions.
 *
 * Everything here is pure (the storage object is passed in) so it can be
 * unit tested in Node with a fake localStorage. The React dialog uses
 * {@link getLocalStorage} to obtain the real one.
 */

export const SIGNATURES_KEY = 'pdf-editor.signatures';
export const MAX_SIGNATURES = 8;

export interface SignatureImage {
  /** PNG (or JPEG) data URL, cropped to the ink with a transparent background. */
  dataUrl: string;
  /** Natural size of the image in pixels (used for the aspect ratio when placing). */
  width: number;
  height: number;
}

export interface SavedSignature extends SignatureImage {
  id: string;
  /** Epoch milliseconds. */
  createdAt: number;
}

/** The subset of the Web Storage API we rely on. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** `window.localStorage`, or `null` when it is unavailable or throws (private mode, sandboxed frames). */
export function getLocalStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    // Accessing a blocked storage area throws in some browsers.
    void localStorage.length;
    return localStorage;
  } catch {
    return null;
  }
}

function isValidEntry(value: unknown): value is SavedSignature {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.dataUrl === 'string' &&
    /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(v.dataUrl) &&
    typeof v.width === 'number' &&
    Number.isFinite(v.width) &&
    v.width > 0 &&
    typeof v.height === 'number' &&
    Number.isFinite(v.height) &&
    v.height > 0 &&
    typeof v.createdAt === 'number' &&
    Number.isFinite(v.createdAt)
  );
}

/** Parse the stored JSON; corrupt or foreign data yields an empty list rather than an exception. */
export function parseSignatures(json: string | null | undefined): SavedSignature[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: SavedSignature[] = [];
  for (const entry of parsed) {
    if (!isValidEntry(entry) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push({
      id: entry.id,
      dataUrl: entry.dataUrl,
      width: entry.width,
      height: entry.height,
      createdAt: entry.createdAt,
    });
    if (out.length >= MAX_SIGNATURES) break;
  }
  return out;
}

export function loadSignatures(storage: StorageLike | null | undefined): SavedSignature[] {
  if (!storage) return [];
  try {
    return parseSignatures(storage.getItem(SIGNATURES_KEY));
  } catch {
    return [];
  }
}

function newSignatureId(now: number): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return `sig_${c.randomUUID()}`;
  return `sig_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Pure list update: prepend `sig` (newest first). A signature with the same
 * image as an existing entry is moved to the front instead of duplicated.
 * The result never exceeds {@link MAX_SIGNATURES} entries.
 */
export function addToList(list: SavedSignature[], sig: SignatureImage, now = Date.now()): SavedSignature[] {
  const existing = list.find((s) => s.dataUrl === sig.dataUrl);
  const entry: SavedSignature = existing
    ? { ...existing, width: sig.width, height: sig.height }
    : { id: newSignatureId(now), dataUrl: sig.dataUrl, width: sig.width, height: sig.height, createdAt: now };
  const rest = list.filter((s) => s.id !== entry.id);
  return [entry, ...rest].slice(0, MAX_SIGNATURES);
}

export function removeFromList(list: SavedSignature[], id: string): SavedSignature[] {
  return list.filter((s) => s.id !== id);
}

/**
 * Write the list. When the storage quota is exceeded the oldest entries are
 * dropped one by one until the write succeeds. Returns what was actually
 * stored (an empty list when nothing could be written).
 */
export function writeSignatures(storage: StorageLike | null | undefined, list: SavedSignature[]): SavedSignature[] {
  if (!storage) return [];
  let current = list.slice(0, MAX_SIGNATURES);
  for (;;) {
    try {
      if (current.length === 0) storage.removeItem(SIGNATURES_KEY);
      else storage.setItem(SIGNATURES_KEY, JSON.stringify(current));
      return current;
    } catch {
      if (current.length === 0) return [];
      current = current.slice(0, -1);
    }
  }
}

/** Load, add, write. Returns the new list as stored. */
export function saveSignature(
  storage: StorageLike | null | undefined,
  sig: SignatureImage,
  now = Date.now(),
): SavedSignature[] {
  const list = addToList(loadSignatures(storage), sig, now);
  return writeSignatures(storage, list);
}

/** Load, remove, write. Returns the new list as stored. */
export function removeSignature(storage: StorageLike | null | undefined, id: string): SavedSignature[] {
  const list = removeFromList(loadSignatures(storage), id);
  return writeSignatures(storage, list);
}
