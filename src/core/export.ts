import type { PageRef, SourceDoc, SourceId } from './types';

/** STUB — implemented in milestone M1 (see docs/PROGRESS.md). */
export async function exportPdf(_pages: PageRef[], _sources: Record<SourceId, SourceDoc>): Promise<Uint8Array> {
  throw new Error('exportPdf not implemented yet');
}
