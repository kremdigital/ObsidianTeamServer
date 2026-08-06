import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PATCH as moveFile } from '@/app/api/projects/[id]/files/[fileId]/route';
import { applyOperation } from '@/lib/sync/operation-log';
import { generateApiKey } from '@/lib/auth/api-key';
import { API_KEY_HEADER } from '@/lib/auth/api-key-middleware';
import { getProjectRoot } from '@/lib/files/paths';
import { resetDatabase, testPrisma } from '../db';

let storageRoot: string;
let originalStoragePath: string | undefined;

beforeAll(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'osync-move-'));
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
    data: { email: `m-${Date.now()}-${Math.random()}@x.test`, passwordHash: 'h', name: 'O' },
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

let clock = 0;
async function seedFile(
  projectId: string,
  userId: string,
  path: string,
  content: string,
): Promise<string> {
  clock += 1;
  const res = await applyOperation(
    { projectId, authorId: userId, clientId: 'A', vectorClock: { A: clock } },
    {
      opType: 'CREATE',
      filePath: path,
      payload: {
        fileType: 'TEXT',
        mimeType: 'text/markdown',
        contentHash: `h${clock}`,
        size: Buffer.byteLength(content),
      },
      data: Buffer.from(content),
    },
  );
  if (res.outcome.kind !== 'created') throw new Error(`ожидали created для ${path}`);
  return res.outcome.fileId;
}

function moveRequest(plain: string, newPath: string): Request {
  return new Request('http://localhost/api/projects/x/files/y', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', [API_KEY_HEADER]: plain },
    body: JSON.stringify({ newPath }),
  });
}

const call = (plain: string, projectId: string, fileId: string, newPath: string) =>
  moveFile(moveRequest(plain, newPath), {
    params: Promise.resolve({ id: projectId, fileId }),
  });

const diskPath = (projectId: string, path: string) => join(getProjectRoot(projectId), path);

describe('PATCH /api/projects/[id]/files/[fileId] — перемещение', () => {
  it('переносит файл и на диске, и в БД', async () => {
    const { projectId, user, plain } = await seedOwnerWithKey();
    const fileId = await seedFile(projectId, user.id, 'a.md', 'содержимое A');

    const res = await call(plain, projectId, fileId, 'папка/b.md');
    expect(res.status).toBe(200);

    const row = await testPrisma.vaultFile.findUnique({ where: { id: fileId } });
    expect(row?.path).toBe('папка/b.md');
    await expect(readFile(diskPath(projectId, 'папка/b.md'), 'utf8')).resolves.toBe('содержимое A');
  });

  it('на занятый путь отдаёт 409 и НЕ трогает содержимое назначения', async () => {
    const { projectId, user, plain } = await seedOwnerWithKey();
    const srcId = await seedFile(projectId, user.id, 'источник.md', 'текст источника');
    await seedFile(projectId, user.id, 'цель.md', 'текст цели — терять нельзя');

    const res = await call(plain, projectId, srcId, 'цель.md');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('path_exists');

    // Регрессия: раньше `rename` затирал назначение ещё до отказа.
    await expect(readFile(diskPath(projectId, 'цель.md'), 'utf8')).resolves.toBe(
      'текст цели — терять нельзя',
    );
    // Источник остался на месте — и на диске, и в БД.
    await expect(readFile(diskPath(projectId, 'источник.md'), 'utf8')).resolves.toBe(
      'текст источника',
    );
    const src = await testPrisma.vaultFile.findUnique({ where: { id: srcId } });
    expect(src?.path).toBe('источник.md');
  });

  it('путь, занятый тумбстоуном, освобождается — перемещение проходит', async () => {
    const { projectId, user, plain } = await seedOwnerWithKey();
    const srcId = await seedFile(projectId, user.id, 'жив.md', 'живой');
    const goneId = await seedFile(projectId, user.id, 'удалён.md', 'удалённый');
    await testPrisma.vaultFile.update({
      where: { id: goneId },
      data: { deletedAt: new Date() },
    });

    // POST на путь тумбстоуна оживляет запись, поэтому и PATCH обязан пускать:
    // иначе заметку не переместить на место ранее удалённой.
    const res = await call(plain, projectId, srcId, 'удалён.md');
    expect(res.status).toBe(200);

    const src = await testPrisma.vaultFile.findUnique({ where: { id: srcId } });
    expect(src?.path).toBe('удалён.md');
    await expect(readFile(diskPath(projectId, 'удалён.md'), 'utf8')).resolves.toBe('живой');

    // Мёртвая строка уведена на служебный путь — версии и история целы.
    const gone = await testPrisma.vaultFile.findUnique({ where: { id: goneId } });
    expect(gone?.path).toBe(`удалён.md.tombstone-${goneId}`);
    expect(gone?.deletedAt).not.toBeNull();
  });

  it('перемещение на собственный путь — успешный no-op', async () => {
    const { projectId, user, plain } = await seedOwnerWithKey();
    const fileId = await seedFile(projectId, user.id, 'сам.md', 'без изменений');

    const res = await call(plain, projectId, fileId, 'сам.md');
    expect(res.status).toBe(200);
    await expect(readFile(diskPath(projectId, 'сам.md'), 'utf8')).resolves.toBe('без изменений');
  });

  it('некорректный путь отклоняется до любых изменений', async () => {
    const { projectId, user, plain } = await seedOwnerWithKey();
    const fileId = await seedFile(projectId, user.id, 'ok.md', 'цел');

    const res = await call(plain, projectId, fileId, '../побег.md');
    expect(res.status).toBe(400);
    await expect(readFile(diskPath(projectId, 'ok.md'), 'utf8')).resolves.toBe('цел');
  });
});
