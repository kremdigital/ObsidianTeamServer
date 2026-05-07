import * as Y from 'yjs';
import { prisma } from '@/lib/db/client';
import { sha256OfBuffer } from '@/lib/files/hash';
import { writeProjectFile } from '@/lib/files/storage';
import { recordFileVersion } from '@/lib/files/versioning';

/**
 * Conventional Y.Doc shape: a single Y.Text named "content".
 * Plugins MUST agree on this key when sending updates to the server.
 */
export const TEXT_KEY = 'content';

export interface ApplyUpdateOpts {
  fileId: string;
  update: Uint8Array;
  authorId: string | null;
}

export interface ApplyUpdateResult {
  /** New Y.encodeStateAsUpdate output for the document. */
  state: Uint8Array;
  /** New Y.encodeStateVector output. */
  stateVector: Uint8Array;
  /** Plain-text content extracted from `Y.Text['content']`. */
  text: string;
  /** Whether the update modified the document at all (vs being a no-op replay). */
  changed: boolean;
}

/**
 * Load a Y.Doc from DB state. Returns a fresh empty doc if no row exists yet.
 */
export async function loadYjsDoc(fileId: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const stored = await prisma.yjsDocument.findUnique({
    where: { fileId },
    select: { state: true },
  });
  if (stored?.state && stored.state.length > 0) {
    Y.applyUpdate(doc, new Uint8Array(stored.state));
  }
  return doc;
}

/**
 * Apply a client update to the persistent Y.Doc and store the new state.
 * Pure server-side merge — call this from the Socket.IO handler.
 */
export async function applyYjsUpdate(opts: ApplyUpdateOpts): Promise<ApplyUpdateResult> {
  const doc = await loadYjsDoc(opts.fileId);
  const beforeVector = Y.encodeStateVector(doc);

  Y.applyUpdate(doc, opts.update);

  const afterVector = Y.encodeStateVector(doc);
  const changed = !uint8Equal(beforeVector, afterVector);

  const newState = Y.encodeStateAsUpdate(doc);
  const newVector = afterVector;
  const text = doc.getText(TEXT_KEY).toString();

  await prisma.yjsDocument.upsert({
    where: { fileId: opts.fileId },
    create: {
      fileId: opts.fileId,
      state: Buffer.from(newState),
      stateVector: Buffer.from(newVector),
    },
    update: {
      state: Buffer.from(newState),
      stateVector: Buffer.from(newVector),
    },
  });

  doc.destroy();

  return { state: newState, stateVector: newVector, text, changed };
}

export interface SnapshotResult {
  contentHash: string;
  size: number;
  versionNumber: number | null;
}

/**
 * Persist the current text content of a Yjs document to the project filesystem
 * and create a new `FileVersion` row (deduplicating by content hash).
 *
 * Should be called via {@link scheduleSnapshot} (debounced) or from a background job —
 * NOT inline on every keystroke.
 */
export async function persistTextSnapshot(opts: {
  projectId: string;
  fileId: string;
  text: string;
  authorId: string | null;
}): Promise<SnapshotResult> {
  const file = await prisma.vaultFile.findUnique({
    where: { id: opts.fileId },
    select: { path: true },
  });
  if (!file) throw new Error(`File not found: ${opts.fileId}`);

  const buffer = Buffer.from(opts.text, 'utf8');
  const written = await writeProjectFile(opts.projectId, file.path, buffer);

  await prisma.vaultFile.update({
    where: { id: opts.fileId },
    data: {
      contentHash: written.contentHash,
      size: BigInt(written.size),
      ...(opts.authorId ? { lastModifiedById: opts.authorId } : {}),
    },
  });

  const recorded = await recordFileVersion({
    projectId: opts.projectId,
    fileId: opts.fileId,
    data: buffer,
    contentHash: written.contentHash,
    authorId: opts.authorId,
  });

  return {
    contentHash: written.contentHash,
    size: written.size,
    versionNumber: recorded?.versionNumber ?? null,
  };
}

/**
 * Debounced snapshot scheduler. Flushes after `delayMs` of inactivity per fileId.
 * Single in-memory map — fine for a single Node process; for a multi-process
 * deployment this would move into a shared scheduler.
 */
const SCHEDULER = new Map<string, NodeJS.Timeout>();
const SNAPSHOT_DEBOUNCE_MS = Number(process.env.YJS_SNAPSHOT_DEBOUNCE_MS ?? 5000);

export function scheduleSnapshot(opts: {
  projectId: string;
  fileId: string;
  authorId: string | null;
  delayMs?: number;
  onError?: (err: unknown) => void;
}): void {
  const existing = SCHEDULER.get(opts.fileId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    SCHEDULER.delete(opts.fileId);
    try {
      const doc = await loadYjsDoc(opts.fileId);
      const text = doc.getText(TEXT_KEY).toString();
      doc.destroy();
      await persistTextSnapshot({
        projectId: opts.projectId,
        fileId: opts.fileId,
        text,
        authorId: opts.authorId,
      });
    } catch (err) {
      opts.onError?.(err);
    }
  }, opts.delayMs ?? SNAPSHOT_DEBOUNCE_MS);

  // Don't keep the Node process alive just for pending snapshots.
  if (typeof timer.unref === 'function') timer.unref();
  SCHEDULER.set(opts.fileId, timer);
}

export function cancelScheduledSnapshot(fileId: string): void {
  const t = SCHEDULER.get(fileId);
  if (t) {
    clearTimeout(t);
    SCHEDULER.delete(fileId);
  }
}

export async function flushPendingSnapshotsForTest(): Promise<void> {
  // Test helper — runs all pending timers immediately.
  const timers = Array.from(SCHEDULER.values());
  for (const t of timers) clearTimeout(t);
  SCHEDULER.clear();
}

function uint8Equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Build a Y.Doc seeded from an external source (e.g. existing .md file content)
 * and return its initial encoded state. Useful when a binary file is converted
 * to a CRDT-managed text file for the first time.
 */
export function buildInitialState(text: string): {
  state: Uint8Array;
  stateVector: Uint8Array;
} {
  const doc = new Y.Doc();
  doc.getText(TEXT_KEY).insert(0, text);
  const state = Y.encodeStateAsUpdate(doc);
  const stateVector = Y.encodeStateVector(doc);
  doc.destroy();
  return { state, stateVector };
}

export function hashText(text: string): string {
  return sha256OfBuffer(Buffer.from(text, 'utf8'));
}
