/**
 * Операции над папкой.
 *
 * Папок как сущности не существует — есть только префикс в пути файла, поэтому
 * действие над папкой разворачивается в действия над каждым её файлом. Делать
 * это на клиенте означало бы сотни запросов на папке вроде `раскадровки/серия-1`
 * и частичный результат при первом же сбое.
 */
import { mkdtemp, rm, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PATCH as renameFolder,
  DELETE as deleteFolder,
} from '@/app/api/projects/[id]/folders/route';
import { POST as createFile } from '@/app/api/projects/[id]/files/route';
import { applyOperation } from '@/lib/sync/operation-log';
import { generateApiKey } from '@/lib/auth/api-key';
import { API_KEY_HEADER } from '@/lib/auth/api-key-middleware';
import { getProjectRoot } from '@/lib/files/paths';
import { resetDatabase, testPrisma } from '../db';

let storageRoot: string;
let originalStoragePath: string | undefined;

beforeAll(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'osync-folders-'));
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
    data: { email: `f-${Date.now()}-${Math.random()}@x.test`, passwordHash: 'h', name: 'O' },
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

async function seedMemberWithKey(projectId: string, addedById: string, role: 'VIEWER' | 'EDITOR') {
  const user = await testPrisma.user.create({
    data: { email: `v-${Date.now()}-${Math.random()}@x.test`, passwordHash: 'h', name: 'V' },
  });
  const gen = await generateApiKey();
  await testPrisma.apiKey.create({
    data: { userId: user.id, name: 'cli', keyHash: gen.hash, keyPrefix: gen.prefix },
  });
  await testPrisma.projectMember.create({ data: { projectId, userId: user.id, role, addedById } });
  return { user, plain: gen.plain };
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

const rename = (plain: string, projectId: string, path: string, newPath: string) =>
  renameFolder(
    new Request('http://localhost/api/projects/x/folders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', [API_KEY_HEADER]: plain },
      body: JSON.stringify({ path, newPath }),
    }),
    { params: Promise.resolve({ id: projectId }) },
  );

const remove = (plain: string, projectId: string, path: string) =>
  deleteFolder(
    new Request(`http://localhost/api/projects/x/folders?path=${encodeURIComponent(path)}`, {
      method: 'DELETE',
      headers: { [API_KEY_HEADER]: plain },
    }),
    { params: Promise.resolve({ id: projectId }) },
  );

const livePaths = (projectId: string) =>
  testPrisma.vaultFile
    .findMany({
      where: { projectId, deletedAt: null },
      select: { path: true },
      orderBy: { path: 'asc' },
    })
    .then((r) => r.map((x) => x.path));

describe('PATCH /folders — переименование', () => {
  it('переносит все файлы, включая вложенные', async () => {
    const { projectId, user, plain } = await seedOwnerWithKey();
    await seedFile(projectId, user.id, 'папка/один.md', 'первый');
    await seedFile(projectId, user.id, 'папка/вложенная/два.md', 'второй');
    await seedFile(projectId, user.id, 'другая/три.md', 'чужой');

    const res = await rename(plain, projectId, 'папка', 'новая');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { moved: number }).moved).toBe(2);

    expect(await livePaths(projectId)).toEqual([
      'другая/три.md',
      'новая/вложенная/два.md',
      'новая/один.md',
    ]);
    // Содержимое переносится вместе с файлом, а не теряется.
    await expect(readFile(join(getProjectRoot(projectId), 'новая/один.md'), 'utf8')).resolves.toBe(
      'первый',
    );
  });

  it('пишет MOVE в журнал операций на каждый файл', async () => {
    const { projectId, user, plain } = await seedOwnerWithKey();
    await seedFile(projectId, user.id, 'п/а.md', 'a');
    await seedFile(projectId, user.id, 'п/б.md', 'b');

    await rename(plain, projectId, 'п', 'н');

    const moves = await testPrisma.operationLog.count({ where: { projectId, opType: 'MOVE' } });
    // Без записей в журнале клиенты не узнают о переносе — та же ловушка, что
    // с REST-записями в августе.
    expect(moves).toBe(2);
  });

  it('занятый путь отклоняется ДО первого переноса', async () => {
    const { projectId, user, plain } = await seedOwnerWithKey();
    await seedFile(projectId, user.id, 'из/а.md', 'a');
    await seedFile(projectId, user.id, 'из/б.md', 'b');
    await seedFile(projectId, user.id, 'в/б.md', 'занято');

    const res = await rename(plain, projectId, 'из', 'в');
    expect(res.status).toBe(409);
    // Ключевое: ни один файл не сдвинулся — частично переименованная папка
    // хуже честного отказа.
    expect(await livePaths(projectId)).toEqual(['в/б.md', 'из/а.md', 'из/б.md']);
  });

  it('нельзя переместить папку внутрь себя', async () => {
    const { projectId, user, plain } = await seedOwnerWithKey();
    await seedFile(projectId, user.id, 'п/а.md', 'a');

    const res = await rename(plain, projectId, 'п', 'п/внутрь');
    expect(res.status).toBe(400);
    expect(await livePaths(projectId)).toEqual(['п/а.md']);
  });

  it('несуществующая папка — 404', async () => {
    const { projectId, plain } = await seedOwnerWithKey();
    expect((await rename(plain, projectId, 'нет-такой', 'новая')).status).toBe(404);
  });
});

describe('DELETE /folders — удаление', () => {
  it('мягко удаляет все файлы папки и не трогает соседей', async () => {
    const { projectId, user, plain } = await seedOwnerWithKey();
    await seedFile(projectId, user.id, 'п/а.md', 'a');
    await seedFile(projectId, user.id, 'п/вложенная/б.md', 'b');
    await seedFile(projectId, user.id, 'сосед/в.md', 'c');

    const res = await remove(plain, projectId, 'п');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { deleted: number }).deleted).toBe(2);

    expect(await livePaths(projectId)).toEqual(['сосед/в.md']);
  });

  it('пишет DELETE в журнал на каждый файл', async () => {
    const { projectId, user, plain } = await seedOwnerWithKey();
    await seedFile(projectId, user.id, 'п/а.md', 'a');
    await seedFile(projectId, user.id, 'п/б.md', 'b');

    await remove(plain, projectId, 'п');

    expect(await testPrisma.operationLog.count({ where: { projectId, opType: 'DELETE' } })).toBe(2);
  });

  it('несуществующая папка — 404', async () => {
    const { projectId, plain } = await seedOwnerWithKey();
    expect((await remove(plain, projectId, 'нет-такой')).status).toBe(404);
  });
});

describe('PATCH /folders — файл на месте будущего каталога', () => {
  it('отдаёт 409 path_blocked и НЕ переносит ни одного файла', async () => {
    // Тот самый разрыв папки пополам: проверка занятости смотрела только на
    // полные целевые пути, а файл с именем каталога назначения проходил её
    // насквозь и ломал mkdir на середине цикла — половина файлов уже переехала,
    // клиент получал пустой 500.
    const { projectId, user, plain } = await seedOwnerWithKey();
    await seedFile(projectId, user.id, 'из/х/1.md', 'первый');
    await seedFile(projectId, user.id, 'из/у/2.md', 'второй');
    await seedFile(projectId, user.id, 'в/у', 'я файл с именем будущей папки');

    const res = await rename(plain, projectId, 'из', 'в');
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('path_blocked');
    expect(body.error.message).toContain('в/у');

    // Ключевое: ни одного сдвинутого файла.
    expect(await livePaths(projectId)).toEqual(['в/у', 'из/у/2.md', 'из/х/1.md']);
    // И журнал чист — клиентам не разослано несуществующего переноса.
    expect(await testPrisma.operationLog.count({ where: { projectId, opType: 'MOVE' } })).toBe(0);
  });

  it('файлы самой переносимой папки помехой не считаются', async () => {
    // Папка «а» содержит файл «а/б» и «а/б-текст.md». При переносе «а» → «б»
    // сам «а/б» уезжает и освобождает путь — отказывать здесь не за что.
    const { projectId, user, plain } = await seedOwnerWithKey();
    await seedFile(projectId, user.id, 'а/вложенная/1.md', 'первый');
    await seedFile(projectId, user.id, 'а/2.md', 'второй');

    const res = await rename(plain, projectId, 'а', 'б');
    expect(res.status).toBe(200);
    expect(await livePaths(projectId)).toEqual(['б/2.md', 'б/вложенная/1.md']);
  });
});

describe('/folders — права', () => {
  it('VIEWER не может ни переименовать, ни удалить папку', async () => {
    const { projectId, user } = await seedOwnerWithKey();
    await seedFile(projectId, user.id, 'папка/файл.md', 'текст');
    const viewer = await seedMemberWithKey(projectId, user.id, 'VIEWER');

    expect((await rename(viewer.plain, projectId, 'папка', 'новая')).status).toBe(403);
    expect((await remove(viewer.plain, projectId, 'папка')).status).toBe(403);
    // Отказ должен быть настоящим, а не «ответили 403 и всё-таки сделали».
    expect(await livePaths(projectId)).toEqual(['папка/файл.md']);
  });

  it('EDITOR может', async () => {
    const { projectId, user } = await seedOwnerWithKey();
    await seedFile(projectId, user.id, 'папка/файл.md', 'текст');
    const editor = await seedMemberWithKey(projectId, user.id, 'EDITOR');

    expect((await rename(editor.plain, projectId, 'папка', 'новая')).status).toBe(200);
    expect(await livePaths(projectId)).toEqual(['новая/файл.md']);
  });

  it('ключ постороннего пользователя не даёт трогать папки', async () => {
    // 403, а не 404 — так же, как на остальных роутах проекта (GET /files и
    // прочие). Отдельная семантика только у папок расходилась бы с остальным
    // API; то, что 403 подтверждает постороннему существование проекта, —
    // свойство общей конвенции, а не этого роута.
    //
    // Случай «совсем без ключа» здесь не проверить: authenticateRequest
    // проваливается в сессионную ветку, а та зовёт next/headers, недоступный
    // вне request-scope. Этот путь закрыт проверкой на проде (PATCH/DELETE
    // без ключа → 401).
    const { projectId, user } = await seedOwnerWithKey();
    await seedFile(projectId, user.id, 'папка/файл.md', 'текст');
    const outsider = await seedOwnerWithKey();

    expect((await rename(outsider.plain, projectId, 'папка', 'новая')).status).toBe(403);
    expect((await remove(outsider.plain, projectId, 'папка')).status).toBe(403);
    expect(await livePaths(projectId)).toEqual(['папка/файл.md']);
  });
});

describe('POST /files — путь занят папкой', () => {
  const create = (plain: string, projectId: string, path: string, body: string) => {
    const form = new FormData();
    form.append('path', path);
    form.append('file', new Blob([body], { type: 'text/markdown' }), 'x.md');
    return createFile(
      new Request('http://localhost/api/projects/x/files', {
        method: 'POST',
        headers: { [API_KEY_HEADER]: plain },
        body: form,
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
  };

  it('создание файла с именем существующей папки — 409 path_blocked, а не пустой 500', async () => {
    // На проде это было ПУСТОЕ 500 с EISDIR в логе: перенос такую коллизию
    // различал, создание — нет.
    const { projectId, user, plain } = await seedOwnerWithKey();
    await seedFile(projectId, user.id, 'раздел/глава.md', 'содержимое главы');

    const res = await create(plain, projectId, 'раздел', 'подмена');
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('path_blocked');
    expect(body.error.message).toContain('раздел/глава.md');

    // Существующий файл не пострадал, лишней записи не появилось.
    expect(await livePaths(projectId)).toEqual(['раздел/глава.md']);
  });

  it('файл на месте будущего каталога тоже даёт 409 при создании', async () => {
    const { projectId, user, plain } = await seedOwnerWithKey();
    await seedFile(projectId, user.id, 'раздел', 'я файл, а не папка');

    const res = await create(plain, projectId, 'раздел/внутри.md', 'текст');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('path_blocked');
    expect(await livePaths(projectId)).toEqual(['раздел']);
  });

  it('пустой каталог-скелет создание не блокирует', async () => {
    // Скелет остаётся, если файлы удалили старой версией сервера. Он ничего не
    // значит и должен сниматься по требованию, а не отдавать 500.
    const { projectId, user, plain } = await seedOwnerWithKey();
    const fileId = await seedFile(projectId, user.id, 'скелет/внутри.md', 'текст');
    // Воспроизводим состояние «до фикса»: строки нет, файла нет, а каталог на
    // диске остался. Именно так выглядят 139 скелетов, накопившихся на проде.
    await testPrisma.vaultFile.update({ where: { id: fileId }, data: { deletedAt: new Date() } });
    await unlink(join(getProjectRoot(projectId), 'скелет/внутри.md'));

    const res = await create(plain, projectId, 'скелет', 'теперь это файл');
    expect(res.status).toBe(201);
    expect(await livePaths(projectId)).toEqual(['скелет']);
  });
});
