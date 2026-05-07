import * as Y from 'yjs';
import { prisma } from '@/lib/db/client';

export interface CompactResult {
  fileId: string;
  beforeBytes: number;
  afterBytes: number;
  shrunkBy: number;
}

/**
 * Compactify a Yjs document's persisted state: re-encode through `encodeStateAsUpdate`,
 * which collapses internal struct stores. No-op when the result is not smaller.
 */
export async function compactYjsDocument(fileId: string): Promise<CompactResult | null> {
  const stored = await prisma.yjsDocument.findUnique({
    where: { fileId },
    select: { state: true },
  });
  if (!stored?.state || stored.state.length === 0) return null;

  const beforeBytes = stored.state.length;

  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(stored.state));
  const compacted = Y.encodeStateAsUpdate(doc);
  const stateVector = Y.encodeStateVector(doc);
  doc.destroy();

  const afterBytes = compacted.length;
  if (afterBytes >= beforeBytes) {
    return { fileId, beforeBytes, afterBytes, shrunkBy: 0 };
  }

  await prisma.yjsDocument.update({
    where: { fileId },
    data: {
      state: Buffer.from(compacted),
      stateVector: Buffer.from(stateVector),
    },
  });

  return { fileId, beforeBytes, afterBytes, shrunkBy: beforeBytes - afterBytes };
}

/**
 * Walk every YjsDocument in the database and compactify it. Intended to be
 * triggered from a cron / scheduled job (~once per day).
 *
 * Iterates with cursor-based pagination so the bytes of huge documents are
 * never all loaded at once.
 */
export async function compactAllYjsDocuments(opts?: {
  batchSize?: number;
  onProgress?: (result: CompactResult) => void;
}): Promise<CompactResult[]> {
  const batchSize = opts?.batchSize ?? 100;
  const results: CompactResult[] = [];
  let cursorId: string | null = null;

  for (;;) {
    const page: Array<{ id: string; fileId: string }> = await prisma.yjsDocument.findMany({
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      take: batchSize,
      orderBy: { id: 'asc' },
      select: { id: true, fileId: true },
    });
    if (page.length === 0) break;

    for (const row of page) {
      const result = await compactYjsDocument(row.fileId);
      if (result) {
        results.push(result);
        opts?.onProgress?.(result);
      }
    }

    cursorId = page[page.length - 1]?.id ?? null;
    if (page.length < batchSize) break;
  }

  return results;
}
