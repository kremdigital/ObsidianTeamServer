import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as purgeTombstones } from '@/app/api/projects/[id]/purge-tombstones/route';
import { applyOperation } from '@/lib/sync/operation-log';
import { generateApiKey } from '@/lib/auth/api-key';
import { API_KEY_HEADER } from '@/lib/auth/api-key-middleware';
import { writeVersionSnapshot } from '@/lib/files/storage';
import { getProjectRoot } from '@/lib/files/paths';
import { resetDatabase, testPrisma } from '../db';

let storageRoot: string;
let originalStoragePath: string | undefined;

beforeAll(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'osync-purge-'));
  originalStoragePath = process.env.STORAGE_PATH;
  process.env.STORAGE_PATH = storageRoot;
});

afterAll(async () => {
  if (originalStoragePath !== undefined) process.env.STORAGE_PATH = originalStoragePath;
  else delete process.env.STORAGE_PATH;
  await rm(storageRoot, { recursive: true, force: true });
  await testPrisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

async function seedOwnerWithKey() {
  const user = await testPrisma.user.create({
    data: { email: `p-${Date.now()}-${Math.random()}@x.test`, passwordHash: 'h', name: 'O' },
  });
  const gen = await generateApiKey();
  await testPrisma.apiKey.create({
    data: { userId: user.id, name: 'cli', keyHash: gen.hash, keyPrefix: gen.prefix },
  });
  const project = await testPrisma.project.create({
    data: {
      slug: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: 'P',
      ownerId: user.id,
      members: { create: { userId: user.id, role: 'ADMIN', addedById: user.id } },
    },
  });
  return { user, projectId: project.id, plain: gen.plain };
}

function purgeRequest(plain: string | null, body?: object): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (plain) headers[API_KEY_HEADER] = plain;
  return new Request('http://localhost/api/projects/x/purge-tombstones', {
    method: 'POST',
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe('POST /api/projects/[id]/purge-tombstones', () => {
  it('hard-deletes tombstones, their ops, and their version bytes', async () => {
    const { projectId, user, plain } = await seedOwnerWithKey();

    // Create then delete a binary file → tombstone + CREATE/DELETE ops.
    const created = await applyOperation(
      { projectId, authorId: user.id, clientId: 'A', vectorClock: { A: 1 } },
      {
        opType: 'CREATE',
        filePath: 'img/pic.png',
        payload: { fileType: 'BINARY', mimeType: 'image/png', contentHash: 'h1', size: 3 },
        data: Buffer.from('png'),
      },
    );
    if (created.outcome.kind !== 'created') throw new Error('expected created');
    const fileId = created.outcome.fileId;
    await applyOperation(
      { projectId, authorId: user.id, clientId: 'A', vectorClock: { A: 2 } },
      { opType: 'DELETE', filePath: 'img/pic.png', payload: { fileId } },
    );

    // A version snapshot on disk + its FileVersion row.
    await writeVersionSnapshot(projectId, fileId, 1, Buffer.from('png'));
    await testPrisma.fileVersion.create({
      data: {
        fileId,
        versionNumber: 1,
        contentHash: 'h1',
        snapshotPath: `.versions/${fileId}/1.snapshot`,
        authorId: user.id,
      },
    });

    const versionDir = join(getProjectRoot(projectId), '.versions', fileId);
    await expect(stat(versionDir)).resolves.toBeDefined();

    const res = await purgeTombstones(purgeRequest(plain), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      files: number;
      operations: number;
      versionDirsRemoved: number;
    };
    expect(body.files).toBe(1);
    expect(body.operations).toBeGreaterThanOrEqual(2); // CREATE + DELETE
    expect(body.versionDirsRemoved).toBe(1);

    // Rows are gone; the CREATE op can no longer replay to revive the file.
    expect(await testPrisma.vaultFile.count({ where: { projectId } })).toBe(0);
    expect(
      await testPrisma.operationLog.count({ where: { projectId, filePath: 'img/pic.png' } }),
    ).toBe(0);
    expect(await testPrisma.fileVersion.count({ where: { fileId } })).toBe(0);
    // The on-disk version snapshot directory is removed.
    await expect(stat(versionDir)).rejects.toThrow();
  });

  it('leaves live files untouched', async () => {
    const { projectId, user, plain } = await seedOwnerWithKey();
    await applyOperation(
      { projectId, authorId: user.id, clientId: 'A', vectorClock: { A: 1 } },
      {
        opType: 'CREATE',
        filePath: 'keep.md',
        payload: { fileType: 'TEXT', contentHash: 'h1', size: 5 },
        data: Buffer.from('hello'),
      },
    );

    const res = await purgeTombstones(purgeRequest(plain), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: number };
    expect(body.files).toBe(0);
    expect(await testPrisma.vaultFile.count({ where: { projectId, deletedAt: null } })).toBe(1);
  });

  it('scopes op deletion by fileId — a live file that reused a purged path keeps its history', async () => {
    const { projectId, user, plain } = await seedOwnerWithKey();

    // File A created at foo.md, then renamed to bar.md (A now lives at bar.md).
    const a = await applyOperation(
      { projectId, authorId: user.id, clientId: 'A', vectorClock: { A: 1 } },
      {
        opType: 'CREATE',
        filePath: 'foo.md',
        payload: { fileType: 'TEXT', contentHash: 'h1', size: 3 },
        data: Buffer.from('aaa'),
      },
    );
    if (a.outcome.kind !== 'created') throw new Error('expected created');
    await applyOperation(
      { projectId, authorId: user.id, clientId: 'A', vectorClock: { A: 2 } },
      {
        opType: 'RENAME',
        filePath: 'foo.md',
        newPath: 'bar.md',
        payload: { fileId: a.outcome.fileId },
      },
    );

    // File B created at the now-free foo.md, then deleted → tombstone at foo.md.
    const b = await applyOperation(
      { projectId, authorId: user.id, clientId: 'A', vectorClock: { A: 3 } },
      {
        opType: 'CREATE',
        filePath: 'foo.md',
        payload: { fileType: 'TEXT', contentHash: 'h2', size: 3 },
        data: Buffer.from('bbb'),
      },
    );
    if (b.outcome.kind !== 'created') throw new Error('expected created');
    await applyOperation(
      { projectId, authorId: user.id, clientId: 'A', vectorClock: { A: 4 } },
      { opType: 'DELETE', filePath: 'foo.md', payload: { fileId: b.outcome.fileId } },
    );

    const res = await purgeTombstones(purgeRequest(plain), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: number };
    expect(body.files).toBe(1); // only B

    // A stays live; its CREATE op at foo.md must survive — a path-based purge
    // would have deleted it (same path as B), losing A's catch-up history.
    expect(await testPrisma.vaultFile.count({ where: { projectId, deletedAt: null } })).toBe(1);
    const survivingCreate = await testPrisma.operationLog.findFirst({
      where: { projectId, opType: 'CREATE', filePath: 'foo.md' },
    });
    expect(survivingCreate).not.toBeNull();
    expect((survivingCreate?.payload as { fileId?: string })?.fileId).toBe(a.outcome.fileId);
    // B's rows are gone entirely.
    expect(await testPrisma.vaultFile.count({ where: { id: b.outcome.fileId } })).toBe(0);
  });

  it('rejects an authenticated non-member with 403', async () => {
    const { projectId } = await seedOwnerWithKey();
    // A second user with a valid key but no access to the project.
    const outsider = await testPrisma.user.create({
      data: { email: `x-${Date.now()}-${Math.random()}@x.test`, passwordHash: 'h', name: 'X' },
    });
    const gen = await generateApiKey();
    await testPrisma.apiKey.create({
      data: { userId: outsider.id, name: 'cli', keyHash: gen.hash, keyPrefix: gen.prefix },
    });

    const res = await purgeTombstones(purgeRequest(gen.plain), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(res.status).toBe(403);
  });
});
