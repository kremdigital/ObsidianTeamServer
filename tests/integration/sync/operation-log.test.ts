import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  appendConflictSuffix,
  applyOperation,
  listOperationsSince,
} from '@/lib/sync/operation-log';
import { increment } from '@/lib/sync/vector-clock';
import { resetDatabase, testPrisma } from '../db';

let storageRoot: string;
let originalStoragePath: string | undefined;

beforeAll(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'osync-oplog-'));
  originalStoragePath = process.env.STORAGE_PATH;
  process.env.STORAGE_PATH = storageRoot;
});

afterAll(async () => {
  if (originalStoragePath !== undefined) {
    process.env.STORAGE_PATH = originalStoragePath;
  } else {
    delete process.env.STORAGE_PATH;
  }
  await rm(storageRoot, { recursive: true, force: true });
  await testPrisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

async function seedProject() {
  const owner = await testPrisma.user.create({
    data: {
      email: `o-${Date.now()}-${Math.random()}@x.test`,
      passwordHash: 'h',
      name: 'O',
    },
  });
  const project = await testPrisma.project.create({
    data: {
      slug: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: 'P',
      ownerId: owner.id,
      members: { create: { userId: owner.id, role: 'ADMIN', addedById: owner.id } },
    },
  });
  return { ownerId: owner.id, projectId: project.id };
}

describe('appendConflictSuffix', () => {
  it('inserts the suffix before the last dot', () => {
    expect(appendConflictSuffix('note.md', 'A1')).toBe('note.conflict-A1.md');
    expect(appendConflictSuffix('a/b/note.md', 'A1')).toBe('a/b/note.conflict-A1.md');
  });
  it('appends if no extension', () => {
    expect(appendConflictSuffix('readme', 'A1')).toBe('readme.conflict-A1');
  });
  it('sanitizes weird clientIds', () => {
    expect(appendConflictSuffix('note.md', 'a/b c<>')).toBe('note.conflict-a_b_c__.md');
  });
});

describe('applyOperation: CREATE', () => {
  it('creates a file and writes content', async () => {
    const { projectId, ownerId } = await seedProject();
    const result = await applyOperation(
      {
        projectId,
        authorId: ownerId,
        clientId: 'client-A',
        vectorClock: { 'client-A': 1 },
      },
      {
        opType: 'CREATE',
        filePath: 'note.md',
        payload: { fileType: 'TEXT', contentHash: 'h1', size: 5 },
        data: Buffer.from('hello'),
      },
    );
    expect(result.outcome.kind).toBe('created');
    const file = await testPrisma.vaultFile.findFirst({ where: { projectId } });
    expect(file?.path).toBe('note.md');
  });

  it('revives a soft-deleted row at the same path instead of hitting the unique constraint', async () => {
    const { projectId, ownerId } = await seedProject();
    // First CREATE — file is created at note.md.
    const first = await applyOperation(
      { projectId, authorId: ownerId, clientId: 'A', vectorClock: { A: 1 } },
      {
        opType: 'CREATE',
        filePath: 'note.md',
        payload: { fileType: 'TEXT', contentHash: 'h1', size: 5 },
        data: Buffer.from('hello'),
      },
    );
    if (first.outcome.kind !== 'created') throw new Error('expected created');
    const originalId = first.outcome.fileId;

    // Delete it — leaves a tombstone at note.md.
    await applyOperation(
      { projectId, authorId: ownerId, clientId: 'A', vectorClock: { A: 2 } },
      { opType: 'DELETE', filePath: 'note.md', payload: { fileId: originalId } },
    );

    // CREATE again — without the tombstone-revive fix this throws the
    // `@@unique([projectId, path])` violation and leaves the client
    // stuck queueing the op on every retry.
    const second = await applyOperation(
      { projectId, authorId: ownerId, clientId: 'A', vectorClock: { A: 3 } },
      {
        opType: 'CREATE',
        filePath: 'note.md',
        payload: { fileType: 'TEXT', contentHash: 'h2', size: 6 },
        data: Buffer.from('reborn'),
      },
    );
    expect(second.outcome.kind).toBe('created');

    // Exactly one live row at this path, content matches the new CREATE.
    const live = await testPrisma.vaultFile.findMany({
      where: { projectId, path: 'note.md', deletedAt: null },
    });
    expect(live).toHaveLength(1);
    expect(live[0]?.contentHash).toBe('h2');
    expect(live[0]?.size).toBe(6n);
  });

  it('renames into .conflict-<clientId>.<ext> when path is taken', async () => {
    const { projectId, ownerId } = await seedProject();
    await applyOperation(
      {
        projectId,
        authorId: ownerId,
        clientId: 'client-A',
        vectorClock: { 'client-A': 1 },
      },
      {
        opType: 'CREATE',
        filePath: 'collide.md',
        payload: { fileType: 'TEXT', contentHash: 'h1', size: 1 },
        data: Buffer.from('a'),
      },
    );

    const result = await applyOperation(
      {
        projectId,
        authorId: ownerId,
        clientId: 'client-B',
        vectorClock: { 'client-B': 1 },
      },
      {
        opType: 'CREATE',
        filePath: 'collide.md',
        payload: { fileType: 'TEXT', contentHash: 'h2', size: 1 },
        data: Buffer.from('b'),
      },
    );

    expect(result.outcome.kind).toBe('conflict_create_renamed');
    if (result.outcome.kind === 'conflict_create_renamed') {
      expect(result.outcome.finalPath).toBe('collide.conflict-client-B.md');
    }
    const files = await testPrisma.vaultFile.findMany({
      where: { projectId },
      orderBy: { path: 'asc' },
    });
    expect(files.map((f) => f.path)).toEqual(['collide.conflict-client-B.md', 'collide.md']);
  });
});

describe('applyOperation: DELETE > UPDATE', () => {
  it('UPDATE on a tombstoned file becomes a no_op', async () => {
    const { projectId, ownerId } = await seedProject();
    const create = await applyOperation(
      { projectId, authorId: ownerId, clientId: 'A', vectorClock: { A: 1 } },
      {
        opType: 'CREATE',
        filePath: 'doomed.md',
        payload: { fileType: 'TEXT', contentHash: 'h1', size: 1 },
        data: Buffer.from('a'),
      },
    );
    if (create.outcome.kind !== 'created') throw new Error('expected created');
    const fileId = create.outcome.fileId;

    // Concurrent: client A deletes, client B updates.
    await applyOperation(
      { projectId, authorId: ownerId, clientId: 'A', vectorClock: { A: 2 } },
      { opType: 'DELETE', filePath: 'doomed.md', payload: { fileId } },
    );
    const update = await applyOperation(
      { projectId, authorId: ownerId, clientId: 'B', vectorClock: { B: 1 } },
      {
        opType: 'UPDATE',
        filePath: 'doomed.md',
        payload: { fileId, contentHash: 'h2', size: 2 },
        data: Buffer.from('bb'),
      },
    );

    expect(update.outcome.kind).toBe('no_op');
    const reloaded = await testPrisma.vaultFile.findUnique({ where: { id: fileId } });
    expect(reloaded?.deletedAt).not.toBeNull();
    // Hash should NOT have advanced past h1.
    expect(reloaded?.contentHash).toBe('h1');
  });
});

describe('applyOperation: concurrent RENAME', () => {
  it('second RENAME to an occupied target is rerouted to a conflict path', async () => {
    const { projectId, ownerId } = await seedProject();

    const a = await applyOperation(
      { projectId, authorId: ownerId, clientId: 'A', vectorClock: { A: 1 } },
      {
        opType: 'CREATE',
        filePath: 'a.md',
        payload: { fileType: 'TEXT', contentHash: 'h', size: 1 },
        data: Buffer.from('a'),
      },
    );
    const b = await applyOperation(
      { projectId, authorId: ownerId, clientId: 'A', vectorClock: { A: 2 } },
      {
        opType: 'CREATE',
        filePath: 'b.md',
        payload: { fileType: 'TEXT', contentHash: 'h', size: 1 },
        data: Buffer.from('b'),
      },
    );
    const aId = (a.outcome as { fileId: string }).fileId;
    const bId = (b.outcome as { fileId: string }).fileId;

    // First rename: a.md → target.md  (succeeds normally)
    await applyOperation(
      { projectId, authorId: ownerId, clientId: 'A', vectorClock: { A: 3 } },
      { opType: 'RENAME', filePath: 'a.md', newPath: 'target.md', payload: { fileId: aId } },
    );

    // Concurrent: b.md → target.md (already taken) → reroute to conflict path.
    const second = await applyOperation(
      { projectId, authorId: ownerId, clientId: 'B', vectorClock: { B: 1 } },
      { opType: 'RENAME', filePath: 'b.md', newPath: 'target.md', payload: { fileId: bId } },
    );
    expect(second.outcome.kind).toBe('conflict_create_renamed');
    if (second.outcome.kind === 'conflict_create_renamed') {
      expect(second.outcome.finalPath).toBe('target.conflict-B.md');
    }
  });

  it('renames over a soft-deleted tombstone at the target path', async () => {
    const { projectId, ownerId } = await seedProject();

    const a = await applyOperation(
      { projectId, authorId: ownerId, clientId: 'A', vectorClock: { A: 1 } },
      {
        opType: 'CREATE',
        filePath: 'a.md',
        payload: { fileType: 'TEXT', contentHash: 'ha', size: 1 },
        data: Buffer.from('a'),
      },
    );
    const b = await applyOperation(
      { projectId, authorId: ownerId, clientId: 'A', vectorClock: { A: 2 } },
      {
        opType: 'CREATE',
        filePath: 'b.md',
        payload: { fileType: 'TEXT', contentHash: 'hb', size: 1 },
        data: Buffer.from('b'),
      },
    );
    const aId = (a.outcome as { fileId: string }).fileId;
    const bId = (b.outcome as { fileId: string }).fileId;

    // Soft-delete b.md → leaves a tombstone at b.md.
    await applyOperation(
      { projectId, authorId: ownerId, clientId: 'A', vectorClock: { A: 3 } },
      { opType: 'DELETE', filePath: 'b.md', payload: { fileId: bId } },
    );

    // Rename a.md → b.md. Without the tombstone-clearing fix this hits
    // the unique constraint (the tombstone's `[projectId, path]` row is
    // invisible to `findFirst({deletedAt:null})` but visible to the DB).
    const renamed = await applyOperation(
      { projectId, authorId: ownerId, clientId: 'A', vectorClock: { A: 4 } },
      { opType: 'RENAME', filePath: 'a.md', newPath: 'b.md', payload: { fileId: aId } },
    );
    expect(renamed.outcome.kind).toBe('renamed');

    const live = await testPrisma.vaultFile.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { path: 'asc' },
    });
    expect(live.map((f) => f.path)).toEqual(['b.md']);
    expect(live[0]?.id).toBe(aId);
  });
});

describe('listOperationsSince', () => {
  it('returns only ops whose clock advances past the supplied vector', async () => {
    const { projectId, ownerId } = await seedProject();

    let clock = increment({}, 'A');
    await applyOperation(
      { projectId, authorId: ownerId, clientId: 'A', vectorClock: clock },
      {
        opType: 'CREATE',
        filePath: 'a.md',
        payload: { fileType: 'TEXT', contentHash: 'h', size: 1 },
        data: Buffer.from('a'),
      },
    );

    clock = increment(clock, 'A');
    await applyOperation(
      { projectId, authorId: ownerId, clientId: 'A', vectorClock: clock },
      {
        opType: 'CREATE',
        filePath: 'b.md',
        payload: { fileType: 'TEXT', contentHash: 'h', size: 1 },
        data: Buffer.from('b'),
      },
    );

    // From the perspective of a client that has already seen A:1 — they should still
    // pick up the second op (A:2).
    const ops = await listOperationsSince({ projectId, since: { A: 1 } });
    expect(ops.map((o) => o.filePath)).toEqual(['b.md']);

    // From a fresh perspective, they should pick up everything.
    const all = await listOperationsSince({ projectId, since: {} });
    expect(all.map((o) => o.filePath)).toEqual(['a.md', 'b.md']);
  });
});
