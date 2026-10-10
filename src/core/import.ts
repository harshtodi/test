import type { SourceDoc } from './types';

/** STUB — implemented in milestone M1 (see docs/PROGRESS.md). */
export async function importFile(_name: string, _bytes: Uint8Array): Promise<SourceDoc> {
  throw new Error('importFile not implemented yet');
}

/** STUB — create a one-page blank PDF source of the given size (points). */
export async function createBlankPageSource(_width: number, _height: number): Promise<SourceDoc> {
  throw new Error('createBlankPageSource not implemented yet');
}
