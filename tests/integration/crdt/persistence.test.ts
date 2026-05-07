import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { TEXT_KEY, applyYjsUpdate, loadYjsDoc, persistTextSnapshot } from '@/lib/crdt/persistence';
import { compactYjsDocument } from '@/lib/crdt/garbage-collection';
import { resetDatabase, testPrisma } from '../db';

let storageRoot: string;
let originalStoragePath: string | undefined;

beforeAll(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'osync-crdt-'));
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

async function seedFile(initialText: string) {
  const owner = await testPrisma.user.create({
    data: { email: `crdt-${Date.now()}-${Math.random()}@x.test`, passwordHash: 'h', name: 'C' },
  });
  const project = await testPrisma.project.create({
    data: {
      slug: `slug-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: 'P',
      ownerId: owner.id,
      members: { create: { userId: owner.id, role: 'ADMIN', addedById: owner.id } },
    },
  });
  const file = await testPrisma.vaultFile.create({
    data: {
      projectId: project.id,
      path: 'note.md',
      fileType: 'TEXT',
      contentHash: 'init',
      size: BigInt(0),
    },
  });
  return { ownerId: owner.id, projectId: project.id, fileId: file.id, initialText };
}

function makeUpdate(text: string, insertAt = 0): Uint8Array {
  const doc = new Y.Doc();
  doc.getText(TEXT_KEY).insert(insertAt, text);
  return Y.encodeStateAsUpdate(doc);
}

describe('applyYjsUpdate', () => {
  it('creates a YjsDocument and persists text on first update', async () => {
    const { fileId, ownerId } = await seedFile('');
    const result = await applyYjsUpdate({
      fileId,
      update: makeUpdate('Hello'),
      authorId: ownerId,
    });
    expect(result.changed).toBe(true);
    expect(result.text).toBe('Hello');

    const stored = await testPrisma.yjsDocument.findUnique({ where: { fileId } });
    expect(stored).not.toBeNull();
    expect(stored!.state.length).toBeGreaterThan(0);
  });

  it('multiple sequential updates accumulate', async () => {
    const { fileId, ownerId } = await seedFile('');

    await applyYjsUpdate({ fileId, update: makeUpdate('A'), authorId: ownerId });
    await applyYjsUpdate({ fileId, update: makeUpdate('B'), authorId: ownerId });
    const last = await applyYjsUpdate({ fileId, update: makeUpdate('C'), authorId: ownerId });

    // Order is non-deterministic across replicas, but all three letters must appear.
    expect(last.text).toMatch(/A/);
    expect(last.text).toMatch(/B/);
    expect(last.text).toMatch(/C/);
    expect(last.text.length).toBe(3);
  });

  it('survives "process restart" — loadYjsDoc reproduces the exact text', async () => {
    const { fileId, ownerId } = await seedFile('');
    await applyYjsUpdate({ fileId, update: makeUpdate('Hello world'), authorId: ownerId });

    // Simulate fresh process: load from DB only.
    const doc = await loadYjsDoc(fileId);
    expect(doc.getText(TEXT_KEY).toString()).toBe('Hello world');
    doc.destroy();
  });

  it('reports changed=false on a duplicate update (idempotent replay)', async () => {
    const { fileId, ownerId } = await seedFile('');
    const upd = makeUpdate('once');

    const first = await applyYjsUpdate({ fileId, update: upd, authorId: ownerId });
    expect(first.changed).toBe(true);

    const second = await applyYjsUpdate({ fileId, update: upd, authorId: ownerId });
    expect(second.changed).toBe(false);
    expect(second.text).toBe('once');
  });
});

describe('persistTextSnapshot', () => {
  it('writes text to the project filesystem and creates a FileVersion row', async () => {
    const { fileId, projectId, ownerId } = await seedFile('');
    const result = await persistTextSnapshot({
      projectId,
      fileId,
      text: 'snapshot content',
      authorId: ownerId,
    });

    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.versionNumber).toBe(1);

    const onDisk = await readFile(join(storageRoot, projectId, 'note.md'), 'utf8');
    expect(onDisk).toBe('snapshot content');

    const versions = await testPrisma.fileVersion.findMany({ where: { fileId } });
    expect(versions).toHaveLength(1);

    const file = await testPrisma.vaultFile.findUnique({ where: { id: fileId } });
    expect(file?.contentHash).toBe(result.contentHash);
  });

  it('deduplicates: identical content does NOT add a new version', async () => {
    const { fileId, projectId, ownerId } = await seedFile('');
    await persistTextSnapshot({ projectId, fileId, text: 'same', authorId: ownerId });
    const second = await persistTextSnapshot({
      projectId,
      fileId,
      text: 'same',
      authorId: ownerId,
    });
    expect(second.versionNumber).toBeNull();
    expect(await testPrisma.fileVersion.count({ where: { fileId } })).toBe(1);
  });
});

describe('compactYjsDocument', () => {
  it('does not change document semantics after compaction', async () => {
    const { fileId, ownerId } = await seedFile('');
    // Apply many small updates to grow the state.
    for (const ch of 'abcdefghijklmnop') {
      await applyYjsUpdate({ fileId, update: makeUpdate(ch), authorId: ownerId });
    }
    const before = await loadYjsDoc(fileId);
    const beforeText = before.getText(TEXT_KEY).toString();
    before.destroy();

    await compactYjsDocument(fileId);

    const after = await loadYjsDoc(fileId);
    expect(after.getText(TEXT_KEY).toString()).toBe(beforeText);
    after.destroy();
  });
});
