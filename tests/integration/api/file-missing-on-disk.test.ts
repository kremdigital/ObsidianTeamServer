/**
 * Расхождение БД и диска: запись есть, файла нет.
 *
 * `createReadStream` на отсутствующем файле не бросает синхронно — ошибка
 * приходит событием, когда ответ 200 уже отдан. Соединение обрывалось, и
 * пользователь получал `HTTP 502` вместо внятного кода, а `list_notes` показывал
 * заметку живой. Сценарий возможен при любом расхождении: ручные правки БД, сбой
 * файловой системы, оборванная операция переноса.
 */
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as getFile } from '@/app/api/projects/[id]/files/[fileId]/route';
import { GET as downloadFolder } from '@/app/api/projects/[id]/folders/download/route';
import { applyOperation } from '@/lib/sync/operation-log';
import { generateApiKey } from '@/lib/auth/api-key';
import { API_KEY_HEADER } from '@/lib/auth/api-key-middleware';
import { getProjectRoot } from '@/lib/files/paths';
import { resetDatabase, testPrisma } from '../db';

let storageRoot: string;
let originalStoragePath: string | undefined;

beforeAll(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'osync-missing-'));
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
    data: { email: `x-${Date.now()}-${Math.random()}@x.test`, passwordHash: 'h', name: 'O' },
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
async function seedFile(projectId: string, userId: string, path: string, content: string) {
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

const readFileReq = (plain: string, projectId: string, fileId: string) =>
  getFile(
    new Request('http://localhost/api/projects/x/files/y', {
      headers: { [API_KEY_HEADER]: plain },
    }),
    { params: Promise.resolve({ id: projectId, fileId }) },
  );

describe('GET /files/[fileId] — файла нет на диске', () => {
  it('отдаёт 404 с отдельным кодом, а не рвёт соединение', async () => {
    const { projectId, user, plain } = await seedOwnerWithKey();
    const fileId = await seedFile(projectId, user.id, 'пропал.md', 'текст');
    await unlink(join(getProjectRoot(projectId), 'пропал.md'));

    const res = await readFileReq(plain, projectId, fileId);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    // Отдельный код: клиенту важно отличать «нет записи» от «нет байтов».
    expect(body.error.code).toBe('file_missing_on_disk');
  });

  it('целый файл по-прежнему отдаётся', async () => {
    const { projectId, user, plain } = await seedOwnerWithKey();
    const fileId = await seedFile(projectId, user.id, 'цел.md', 'содержимое');

    const res = await readFileReq(plain, projectId, fileId);
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe('содержимое');
  });

  it('content-length берётся с диска, а не из БД', async () => {
    const { projectId, user, plain } = await seedOwnerWithKey();
    const fileId = await seedFile(projectId, user.id, 'размер.md', 'короткий');
    // Имитируем расхождение метаданных — оно уже случалось после сбойного
    // переноса. Заголовок обязан соответствовать реально отправленным байтам,
    // иначе клиент повиснет в ожидании недостающих данных.
    await testPrisma.vaultFile.update({ where: { id: fileId }, data: { size: BigInt(99999) } });

    const res = await readFileReq(plain, projectId, fileId);
    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength('короткий')));
  });

  it('удалённая заметка по-прежнему даёт обычный 404', async () => {
    const { projectId, user, plain } = await seedOwnerWithKey();
    const fileId = await seedFile(projectId, user.id, 'тумбстоун.md', 'текст');
    await testPrisma.vaultFile.update({ where: { id: fileId }, data: { deletedAt: new Date() } });

    const res = await readFileReq(plain, projectId, fileId);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_found');
  });
});

describe('GET /folders/download — часть файлов отсутствует', () => {
  const download = (plain: string, projectId: string, folder: string) =>
    downloadFolder(
      new Request(
        `http://localhost/api/projects/x/folders/download?path=${encodeURIComponent(folder)}`,
        {
          headers: { [API_KEY_HEADER]: plain },
        },
      ),
      { params: Promise.resolve({ id: projectId }) },
    );

  it('пропускает потерянный файл и всё равно отдаёт архив', async () => {
    const { projectId, user, plain } = await seedOwnerWithKey();
    await seedFile(projectId, user.id, 'папка/цел.md', 'на месте');
    await seedFile(projectId, user.id, 'папка/пропал.md', 'исчез');
    await unlink(join(getProjectRoot(projectId), 'папка/пропал.md'));

    // Раньше один потерянный файл обрывал весь архив в середине потока —
    // папка становилась нескачиваемой целиком.
    const res = await download(plain, projectId, 'папка');
    expect(res.status).toBe(200);
    const zip = Buffer.from(await res.arrayBuffer());
    expect(zip.byteLength).toBeGreaterThan(0);
    expect(zip.subarray(0, 2).toString()).toBe('PK');
  });

  it('если не осталось ни одного файла — внятный 404', async () => {
    const { projectId, user, plain } = await seedOwnerWithKey();
    await seedFile(projectId, user.id, 'пусто/один.md', 'текст');
    await unlink(join(getProjectRoot(projectId), 'пусто/один.md'));

    const res = await download(plain, projectId, 'пусто');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'files_missing_on_disk',
    );
  });
});
