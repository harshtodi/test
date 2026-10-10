import { describe, expect, it } from 'vitest';
import {
  MAX_SIGNATURES,
  SIGNATURES_KEY,
  addToList,
  loadSignatures,
  parseSignatures,
  removeFromList,
  removeSignature,
  saveSignature,
  writeSignatures,
} from '@/components/Signature/signature-store';
import type { SavedSignature, StorageLike } from '@/components/Signature/signature-store';

/** Minimal in-memory localStorage stand-in. */
function fakeStorage(
  initial: Record<string, string> = {},
): StorageLike & { data: Map<string, string>; failNextSet: number; maxValueLength: number; failRemove: boolean } {
  const data = new Map(Object.entries(initial));
  const store = {
    data,
    failNextSet: 0,
    /** Writes longer than this "exceed the quota" (and leave the old value in place, like the real thing). */
    maxValueLength: Infinity,
    failRemove: false,
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (store.failNextSet > 0) {
        store.failNextSet--;
        throw new DOMException('quota', 'QuotaExceededError');
      }
      if (v.length > store.maxValueLength) throw new DOMException('quota', 'QuotaExceededError');
      data.set(k, v);
    },
    removeItem: (k: string) => {
      if (store.failRemove) throw new DOMException('blocked', 'SecurityError');
      data.delete(k);
    },
  };
  return store;
}

const png = (tag: string) => `data:image/png;base64,${Buffer.from(tag).toString('base64')}`;
const sig = (tag: string, w = 120, h = 40) => ({ dataUrl: png(tag), width: w, height: h });

describe('parseSignatures', () => {
  it('returns an empty list for missing, empty, corrupt or foreign JSON', () => {
    expect(parseSignatures(null)).toEqual([]);
    expect(parseSignatures(undefined)).toEqual([]);
    expect(parseSignatures('')).toEqual([]);
    expect(parseSignatures('{not json')).toEqual([]);
    expect(parseSignatures('42')).toEqual([]);
    expect(parseSignatures('"string"')).toEqual([]);
    expect(parseSignatures('{"a":1}')).toEqual([]);
    expect(parseSignatures('null')).toEqual([]);
  });

  it('keeps only well-formed entries and drops duplicates ids', () => {
    const good: SavedSignature = { id: 'sig_1', dataUrl: png('a'), width: 10, height: 5, createdAt: 1000 };
    const list = [
      good,
      { ...good, id: 'sig_1' }, // duplicate id
      { id: 'sig_2', dataUrl: 'javascript:alert(1)', width: 10, height: 5, createdAt: 1 }, // not an image data URL
      { id: 'sig_3', dataUrl: png('c'), width: 0, height: 5, createdAt: 1 }, // zero width
      { id: 'sig_4', dataUrl: png('d'), width: 10, height: 5 }, // missing createdAt
      { id: '', dataUrl: png('e'), width: 10, height: 5, createdAt: 1 }, // empty id
      'garbage',
      null,
      { id: 'sig_5', dataUrl: png('f'), width: 10, height: 5, createdAt: 2, extra: 'ignored' },
    ];
    const parsed = parseSignatures(JSON.stringify(list));
    expect(parsed.map((s) => s.id)).toEqual(['sig_1', 'sig_5']);
    // unknown fields are not carried along
    expect(Object.keys(parsed[1]!).sort()).toEqual(['createdAt', 'dataUrl', 'height', 'id', 'width']);
  });

  it('truncates oversized stored lists to the maximum', () => {
    const many = Array.from({ length: MAX_SIGNATURES + 5 }, (_, i) => ({
      id: `sig_${i}`,
      dataUrl: png(String(i)),
      width: 1,
      height: 1,
      createdAt: i,
    }));
    expect(parseSignatures(JSON.stringify(many))).toHaveLength(MAX_SIGNATURES);
  });
});

describe('addToList / removeFromList', () => {
  it('prepends new signatures (newest first)', () => {
    let list: SavedSignature[] = [];
    list = addToList(list, sig('a'), 1);
    list = addToList(list, sig('b'), 2);
    expect(list.map((s) => s.dataUrl)).toEqual([png('b'), png('a')]);
    expect(list[0]!.createdAt).toBe(2);
    expect(list[0]!.id).toMatch(/^sig_/);
    expect(list[0]!.id).not.toBe(list[1]!.id);
  });

  it('moves an identical image to the front instead of duplicating it', () => {
    let list: SavedSignature[] = [];
    list = addToList(list, sig('a'), 1);
    list = addToList(list, sig('b'), 2);
    const idA = list[1]!.id;
    list = addToList(list, sig('a', 300, 100), 3);
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe(idA);
    expect(list[0]!.width).toBe(300);
    expect(list[0]!.createdAt).toBe(1); // original creation time is kept
  });

  it('never exceeds MAX_SIGNATURES, dropping the oldest', () => {
    let list: SavedSignature[] = [];
    for (let i = 0; i < MAX_SIGNATURES + 3; i++) list = addToList(list, sig(`s${i}`), i);
    expect(list).toHaveLength(MAX_SIGNATURES);
    expect(list[0]!.dataUrl).toBe(png(`s${MAX_SIGNATURES + 2}`));
    expect(list[list.length - 1]!.dataUrl).toBe(png('s3'));
  });

  it('removes by id and tolerates unknown ids', () => {
    let list: SavedSignature[] = [];
    list = addToList(list, sig('a'), 1);
    list = addToList(list, sig('b'), 2);
    const removed = removeFromList(list, list[0]!.id);
    expect(removed.map((s) => s.dataUrl)).toEqual([png('a')]);
    expect(removeFromList(removed, 'nope')).toEqual(removed);
  });
});

describe('storage round trip', () => {
  it('saves under the documented key and loads back', () => {
    const storage = fakeStorage();
    const list = saveSignature(storage, sig('a'), 10);
    expect(storage.data.has(SIGNATURES_KEY)).toBe(true);
    expect(loadSignatures(storage)).toEqual(list);
    const list2 = saveSignature(storage, sig('b'), 20);
    expect(list2.map((s) => s.dataUrl)).toEqual([png('b'), png('a')]);
    expect(loadSignatures(storage)).toEqual(list2);
  });

  it('removes entries and clears the key when the list becomes empty', () => {
    const storage = fakeStorage();
    const [a] = saveSignature(storage, sig('a'), 1);
    const [b] = saveSignature(storage, sig('b'), 2);
    expect(removeSignature(storage, a!.id)).toEqual([b]);
    expect(removeSignature(storage, b!.id)).toEqual([]);
    expect(storage.data.has(SIGNATURES_KEY)).toBe(false);
  });

  it('recovers from corrupt stored data', () => {
    const storage = fakeStorage({ [SIGNATURES_KEY]: '{"broken": tru' });
    expect(loadSignatures(storage)).toEqual([]);
    const list = saveSignature(storage, sig('fresh'), 5);
    expect(list).toHaveLength(1);
    expect(loadSignatures(storage)).toEqual(list);
  });

  it('works without any storage at all', () => {
    expect(loadSignatures(null)).toEqual([]);
    expect(loadSignatures(undefined)).toEqual([]);
    expect(saveSignature(null, sig('a'))).toEqual([]);
    expect(removeSignature(undefined, 'x')).toEqual([]);
  });

  it('swallows a storage that throws on read', () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadSignatures(storage)).toEqual([]);
    expect(saveSignature(storage, sig('a'))).toEqual([]);
  });

  it('drops the oldest entries when the quota is exceeded', () => {
    const storage = fakeStorage();
    let list: SavedSignature[] = [];
    for (let i = 0; i < 4; i++) list = addToList(list, sig(`s${i}`), i);
    storage.failNextSet = 2; // the first two writes "exceed the quota"
    const stored = writeSignatures(storage, list);
    expect(stored).toHaveLength(2);
    expect(stored.map((s) => s.dataUrl)).toEqual([png('s3'), png('s2')]);
    expect(loadSignatures(storage)).toEqual(stored);
  });

  it('keeps the stored list untouched when not even the newest entry fits', () => {
    const storage = fakeStorage();
    let list: SavedSignature[] = [];
    for (let i = 0; i < 3; i++) list = saveSignature(storage, sig(`s${i}`), i);
    const before = storage.data.get(SIGNATURES_KEY)!;
    expect(list).toHaveLength(3);

    // The quota is a little above what is stored: the new one alone is already too big.
    storage.maxValueLength = before.length + 50;
    const huge = sig('x'.repeat(2000), 1600, 400);
    const stored = saveSignature(storage, huge, 99);

    expect(stored).toEqual(list); // what the dialog will list: the three old ones, not nothing
    expect(stored.some((s) => s.dataUrl === huge.dataUrl)).toBe(false);
    expect(storage.data.get(SIGNATURES_KEY)).toBe(before);
    expect(loadSignatures(storage)).toEqual(list);
  });

  it('still evicts old entries when the newest one fits on its own', () => {
    const storage = fakeStorage();
    for (let i = 0; i < 3; i++) saveSignature(storage, sig(`s${i}`), i);
    expect(loadSignatures(storage)).toHaveLength(3);
    const big = sig('y'.repeat(300), 800, 200);
    storage.maxValueLength = JSON.stringify(addToList([], big, 99)).length + 20;
    const stored = saveSignature(storage, big, 99);
    expect(stored.map((s) => s.dataUrl)).toEqual([big.dataUrl]);
    expect(loadSignatures(storage)).toEqual(stored);
  });

  it('reports what is still stored when removing the last entry fails', () => {
    const storage = fakeStorage();
    const [a] = saveSignature(storage, sig('a'), 1);
    storage.failRemove = true;
    expect(removeSignature(storage, a!.id)).toEqual([a]);
  });
});
