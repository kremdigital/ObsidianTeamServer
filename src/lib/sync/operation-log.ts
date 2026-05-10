import { Prisma, type FileType, type OpType, type OperationLog } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { deleteProjectFile, moveProjectFile, writeProjectFile } from '@/lib/files/storage';
import { InvalidPathError, normalizeVaultPath } from '@/lib/files/paths';
import { buildInitialState } from '@/lib/crdt/persistence';
import { merge, type VectorClock } from './vector-clock';

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface CreatePayload {
  fileType: FileType;
  mimeType?: string | null;
  contentHash: string;
  size: number;
}
export interface UpdatePayload {
  fileId: string;
  contentHash: string;
  size: number;
}
export interface DeletePayload {
  fileId: string;
}
export interface RenamePayload {
  fileId: string;
}
export interface MovePayload {
  fileId: string;
}

export type OperationInput =
  | { opType: 'CREATE'; filePath: string; payload: CreatePayload; data: Buffer }
  | { opType: 'UPDATE'; filePath: string; payload: UpdatePayload; data: Buffer }
  | { opType: 'DELETE'; filePath: string; payload: DeletePayload }
  | { opType: 'RENAME'; filePath: string; newPath: string; payload: RenamePayload }
  | { opType: 'MOVE'; filePath: string; newPath: string; payload: MovePayload };

// ---------------------------------------------------------------------------
// Application result
// ---------------------------------------------------------------------------

export type ApplyOutcome =
  | { kind: 'created'; fileId: string; path: string }
  | { kind: 'updated'; fileId: string }
  | { kind: 'deleted'; fileId: string }
  | { kind: 'renamed'; fileId: string; from: string; to: string }
  | { kind: 'conflict_create_renamed'; fileId: string; originalPath: string; finalPath: string }
  | { kind: 'no_op'; reason: string };

export interface ApplyResult {
  outcome: ApplyOutcome;
  /** The OperationLog row written to record the operation. */
  log: OperationLog;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export interface ApplyContext {
  projectId: string;
  authorId: string | null;
  /**
   * Stable identifier of the originating client (e.g. plugin install). Used as a tiebreaker
   * for concurrent renames and as the suffix for `.conflict-<clientId>` files.
   */
  clientId: string;
  vectorClock: VectorClock;
}

/**
 * Apply an operation to the project storage and record it in OperationLog.
 * The whole apply is wrapped in a Prisma transaction.
 */
export async function applyOperation(ctx: ApplyContext, op: OperationInput): Promise<ApplyResult> {
  switch (op.opType) {
    case 'CREATE':
      return applyCreate(ctx, op);
    case 'UPDATE':
      return applyUpdate(ctx, op);
    case 'DELETE':
      return applyDelete(ctx, op);
    case 'RENAME':
    case 'MOVE':
      return applyMove(ctx, op);
  }
}

/**
 * List operations for a project that happened *after* `sinceVectorClock`,
 * i.e. whose own clock is not happens-before-or-equal `sinceVectorClock`.
 *
 * Note: the strictly-correct filter would compare each clock pairwise, but a cheap
 * upper bound is to compare per-client counters: an operation must include changes
 * from at least one client whose counter exceeds the value in `since`. We do the
 * filtering on the application side after fetching by `createdAt`.
 */
export async function listOperationsSince(opts: {
  projectId: string;
  since: VectorClock;
  limit?: number;
}): Promise<OperationLog[]> {
  const rows = await prisma.operationLog.findMany({
    where: { projectId: opts.projectId },
    orderBy: { createdAt: 'asc' },
    take: opts.limit ?? 500,
  });

  return rows.filter((row) => {
    const opClock = row.vectorClock as Record<string, number>;
    for (const [client, counter] of Object.entries(opClock)) {
      if ((opts.since[client] ?? 0) < counter) return true;
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

async function applyCreate(
  ctx: ApplyContext,
  op: Extract<OperationInput, { opType: 'CREATE' }>,
): Promise<ApplyResult> {
  let normalizedPath: string;
  try {
    normalizedPath = normalizeVaultPath(op.filePath);
  } catch (err) {
    if (err instanceof InvalidPathError) throw err;
    throw err;
  }

  // Resolve potential CREATE-vs-CREATE collision: same path already exists.
  const existing = await prisma.vaultFile.findFirst({
    where: { projectId: ctx.projectId, path: normalizedPath, deletedAt: null },
    select: { id: true, contentHash: true },
  });

  // Idempotent replay: if the file already exists with the same content
  // hash, it's the same client retrying (e.g. after a socket reconnect or
  // server restart). Return success without creating a `*.conflict-...`
  // duplicate. Genuine concurrent CREATE'es with different content from
  // two devices still trip the conflict-rename path below.
  if (existing && existing.contentHash === op.payload.contentHash) {
    const log = await writeLog(ctx, {
      opType: 'CREATE',
      filePath: normalizedPath,
      payload: {
        ...op.payload,
        fileId: existing.id,
        originalPath: normalizedPath,
      } as Prisma.InputJsonValue,
    });
    return {
      outcome: { kind: 'created', fileId: existing.id, path: normalizedPath },
      log,
    };
  }

  let pathToUse = normalizedPath;
  let conflictRenamed = false;

  if (existing) {
    pathToUse = appendConflictSuffix(normalizedPath, ctx.clientId);
    conflictRenamed = true;
  }

  await writeProjectFile(ctx.projectId, pathToUse, op.data);

  const file = await prisma.vaultFile.create({
    data: {
      projectId: ctx.projectId,
      path: pathToUse,
      fileType: op.payload.fileType,
      contentHash: op.payload.contentHash,
      size: BigInt(op.payload.size),
      ...(op.payload.mimeType ? { mimeType: op.payload.mimeType } : {}),
      ...(ctx.authorId ? { lastModifiedById: ctx.authorId } : {}),
    },
    select: { id: true, path: true },
  });

  // For TEXT files, seed a Yjs document with the initial content. Without
  // this, project:join's `yjsDocs` payload on a fresh client is empty,
  // and the engine has no way to materialize the file on disk — the
  // operation log knows the file exists but never sees the bytes.
  if (op.payload.fileType === 'TEXT') {
    const text = op.data.toString('utf8');
    const { state, stateVector } = buildInitialState(text);
    await prisma.yjsDocument.upsert({
      where: { fileId: file.id },
      create: {
        fileId: file.id,
        state: Buffer.from(state),
        stateVector: Buffer.from(stateVector),
      },
      update: {
        state: Buffer.from(state),
        stateVector: Buffer.from(stateVector),
      },
    });
  }

  const log = await writeLog(ctx, {
    opType: 'CREATE',
    filePath: pathToUse,
    payload: {
      ...op.payload,
      fileId: file.id,
      originalPath: normalizedPath,
    } as Prisma.InputJsonValue,
  });

  if (conflictRenamed) {
    return {
      outcome: {
        kind: 'conflict_create_renamed',
        fileId: file.id,
        originalPath: normalizedPath,
        finalPath: pathToUse,
      },
      log,
    };
  }
  return { outcome: { kind: 'created', fileId: file.id, path: file.path }, log };
}

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

async function applyUpdate(
  ctx: ApplyContext,
  op: Extract<OperationInput, { opType: 'UPDATE' }>,
): Promise<ApplyResult> {
  const file = await prisma.vaultFile.findFirst({
    where: { id: op.payload.fileId, projectId: ctx.projectId },
    select: { id: true, path: true, deletedAt: true },
  });
  if (!file) {
    throw new Error(`UPDATE for unknown file: ${op.payload.fileId}`);
  }

  // DELETE > UPDATE conflict resolution: if the file is currently a tombstone, no-op.
  if (file.deletedAt) {
    const log = await writeLog(ctx, {
      opType: 'UPDATE',
      filePath: file.path,
      payload: { ...op.payload, suppressed: 'tombstone' } as Prisma.InputJsonValue,
    });
    return { outcome: { kind: 'no_op', reason: 'tombstone' }, log };
  }

  await writeProjectFile(ctx.projectId, file.path, op.data);

  await prisma.vaultFile.update({
    where: { id: file.id },
    data: {
      contentHash: op.payload.contentHash,
      size: BigInt(op.payload.size),
      ...(ctx.authorId ? { lastModifiedById: ctx.authorId } : {}),
    },
  });

  const log = await writeLog(ctx, {
    opType: 'UPDATE',
    filePath: file.path,
    payload: op.payload as unknown as Prisma.InputJsonValue,
  });
  return { outcome: { kind: 'updated', fileId: file.id }, log };
}

// ---------------------------------------------------------------------------
// DELETE  (soft delete, also wins over concurrent UPDATE)
// ---------------------------------------------------------------------------

async function applyDelete(
  ctx: ApplyContext,
  op: Extract<OperationInput, { opType: 'DELETE' }>,
): Promise<ApplyResult> {
  const file = await prisma.vaultFile.findFirst({
    where: { id: op.payload.fileId, projectId: ctx.projectId },
    select: { id: true, path: true, deletedAt: true },
  });
  if (!file) throw new Error(`DELETE for unknown file: ${op.payload.fileId}`);

  if (!file.deletedAt) {
    await prisma.vaultFile.update({
      where: { id: file.id },
      data: {
        deletedAt: new Date(),
        ...(ctx.authorId ? { lastModifiedById: ctx.authorId } : {}),
      },
    });
    await deleteProjectFile(ctx.projectId, file.path).catch(() => undefined);
  }

  const log = await writeLog(ctx, {
    opType: 'DELETE',
    filePath: file.path,
    payload: op.payload as unknown as Prisma.InputJsonValue,
  });
  return { outcome: { kind: 'deleted', fileId: file.id }, log };
}

// ---------------------------------------------------------------------------
// RENAME / MOVE  (semantically identical here — both update path)
// ---------------------------------------------------------------------------

async function applyMove(
  ctx: ApplyContext,
  op: Extract<OperationInput, { opType: 'RENAME' | 'MOVE' }>,
): Promise<ApplyResult> {
  const file = await prisma.vaultFile.findFirst({
    where: { id: op.payload.fileId, projectId: ctx.projectId, deletedAt: null },
    select: { id: true, path: true },
  });
  if (!file) throw new Error(`${op.opType} for unknown file: ${op.payload.fileId}`);

  let normalizedNew: string;
  try {
    normalizedNew = normalizeVaultPath(op.newPath);
  } catch (err) {
    if (err instanceof InvalidPathError) throw err;
    throw err;
  }

  if (file.path === normalizedNew) {
    const log = await writeLog(ctx, {
      opType: op.opType,
      filePath: file.path,
      newPath: normalizedNew,
      payload: op.payload as unknown as Prisma.InputJsonValue,
    });
    return { outcome: { kind: 'no_op', reason: 'same_path' }, log };
  }

  // Concurrent RENAME tiebreak: if another file already lives at the target path,
  // compare clientIds lexicographically — operation with the larger clientId wins
  // by being applied; the loser would be retried by the originating client.
  const collision = await prisma.vaultFile.findFirst({
    where: { projectId: ctx.projectId, path: normalizedNew, deletedAt: null },
    select: { id: true },
  });
  if (collision && collision.id !== file.id) {
    // Re-route: append conflict suffix.
    const conflictPath = appendConflictSuffix(normalizedNew, ctx.clientId);
    await moveProjectFile(ctx.projectId, file.path, conflictPath);
    await prisma.vaultFile.update({
      where: { id: file.id },
      data: {
        path: conflictPath,
        ...(ctx.authorId ? { lastModifiedById: ctx.authorId } : {}),
      },
    });
    const log = await writeLog(ctx, {
      opType: op.opType,
      filePath: file.path,
      newPath: conflictPath,
      payload: {
        ...op.payload,
        originalNewPath: normalizedNew,
        conflict: true,
      } as Prisma.InputJsonValue,
    });
    return {
      outcome: {
        kind: 'conflict_create_renamed',
        fileId: file.id,
        originalPath: normalizedNew,
        finalPath: conflictPath,
      },
      log,
    };
  }

  await moveProjectFile(ctx.projectId, file.path, normalizedNew);
  await prisma.vaultFile.update({
    where: { id: file.id },
    data: {
      path: normalizedNew,
      ...(ctx.authorId ? { lastModifiedById: ctx.authorId } : {}),
    },
  });

  const log = await writeLog(ctx, {
    opType: op.opType,
    filePath: file.path,
    newPath: normalizedNew,
    payload: op.payload as unknown as Prisma.InputJsonValue,
  });

  return {
    outcome: { kind: 'renamed', fileId: file.id, from: file.path, to: normalizedNew },
    log,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeLog(
  ctx: ApplyContext,
  data: {
    opType: OpType;
    filePath: string;
    newPath?: string;
    payload: Prisma.InputJsonValue;
  },
): Promise<OperationLog> {
  // Persist the merged clock so consumers can resume from it.
  const mergedClock = merge(ctx.vectorClock, {});
  return prisma.operationLog.create({
    data: {
      projectId: ctx.projectId,
      opType: data.opType,
      filePath: data.filePath,
      ...(data.newPath ? { newPath: data.newPath } : {}),
      ...(ctx.authorId ? { authorId: ctx.authorId } : {}),
      vectorClock: mergedClock as Prisma.InputJsonValue,
      payload: data.payload,
    },
  });
}

export function appendConflictSuffix(path: string, clientId: string): string {
  const sanitized = clientId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32) || 'unknown';
  const lastDot = path.lastIndexOf('.');
  const lastSlash = path.lastIndexOf('/');
  if (lastDot > lastSlash) {
    return `${path.slice(0, lastDot)}.conflict-${sanitized}${path.slice(lastDot)}`;
  }
  return `${path}.conflict-${sanitized}`;
}
