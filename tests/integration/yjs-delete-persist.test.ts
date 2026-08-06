/**
 * Правка-удаление в текстовом файле должна доходить до диска.
 *
 * `applyYjsUpdate` определял факт изменения по вектору состояния, а вектор в
 * Yjs отражает только вставки. Правка, состоящая лишь из удаления, давала
 * `changed === false`: обработчик `yjs:update` не планировал снапшот на диск и
 * не рассылал её другим клиентам. В CRDT удаление было, а файл оставался со
 * старым текстом — вместе со всем, что его читает (REST-скачивание, размер в
 * веб-UI, catch-up новых клиентов).
 */
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyYjsUpdate, persistTextSnapshot, TEXT_KEY } from '@/lib/crdt/persistence';
import { applyOperation } from '@/lib/sync/operation-log';
import { getProjectRoot } from '@/lib/files/paths';
import { resetDatabase, testPrisma } from './db';

let storageRoot: string;
let originalStoragePath: string | undefined;

beforeAll(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'osync-ydel-'));
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

async function seedProjectWithFile(text: string) {
  const user = await testPrisma.user.create({
    data: { email: `y-${Date.now()}-${Math.random()}@x.test`, passwordHash: 'h', name: 'O' },
  });
  const project = await testPrisma.project.create({
    data: {
      slug: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: 'P',
      ownerId: user.id,
      members: { create: { userId: user.id, role: 'ADMIN', addedById: user.id } },
    },
  });
  const res = await applyOperation(
    { projectId: project.id, authorId: user.id, clientId: 'A', vectorClock: { A: 1 } },
    {
      opType: 'CREATE',
      filePath: 'заметка.md',
      payload: {
        fileType: 'TEXT',
        mimeType: 'text/markdown',
        contentHash: 'h1',
        size: Buffer.byteLength(text),
      },
      data: Buffer.from(text),
    },
  );
  if (res.outcome.kind !== 'created') throw new Error('ожидали created');
  return { userId: user.id, projectId: project.id, fileId: res.outcome.fileId };
}

/** Обновление, каким его прислал бы клиент: применяем правку к своей копии. */
async function clientUpdate(fileId: string, edit: (t: Y.Text) => void): Promise<Uint8Array> {
  const stored = await testPrisma.yjsDocument.findUniqueOrThrow({ where: { fileId } });
  const client = new Y.Doc();
  Y.applyUpdate(client, new Uint8Array(stored.state));
  const before = Y.encodeStateVector(client);
  edit(client.getText(TEXT_KEY));
  return Y.encodeStateAsUpdate(client, before);
}

describe('yjs: правка-удаление доходит до диска', () => {
  it('чистое удаление помечается как изменение', async () => {
    const { projectId, userId, fileId } = await seedProjectWithFile('строка один\nстрока два\n');

    // «строка один\n» — 12 символов; убираем ровно вторую строку с её переводом.
    const update = await clientUpdate(fileId, (t) => t.delete(12, 11));
    const result = await applyYjsUpdate({ fileId, update, authorId: userId });

    // Регрессия: раньше здесь было false — вектор состояния удаление не видит.
    expect(result.changed).toBe(true);
    expect(result.text).toBe('строка один\n');

    // Снапшот (его планирует обработчик при changed) кладёт текст на диск.
    await persistTextSnapshot({ projectId, fileId, text: result.text, authorId: userId });
    await expect(readFile(join(getProjectRoot(projectId), 'заметка.md'), 'utf8')).resolves.toBe(
      'строка один\n',
    );
  });

  it('удаление всего текста тоже считается изменением', async () => {
    const { userId, fileId } = await seedProjectWithFile('весь текст\n');
    const update = await clientUpdate(fileId, (t) => t.delete(0, t.length));
    const result = await applyYjsUpdate({ fileId, update, authorId: userId });
    expect(result.changed).toBe(true);
    expect(result.text).toBe('');
  });

  it('вставка по-прежнему считается изменением', async () => {
    const { userId, fileId } = await seedProjectWithFile('начало\n');
    const update = await clientUpdate(fileId, (t) => t.insert(t.length, 'добавка\n'));
    const result = await applyYjsUpdate({ fileId, update, authorId: userId });
    expect(result.changed).toBe(true);
    expect(result.text).toBe('начало\nдобавка\n');
  });

  it('повторное применение того же обновления изменением не считается', async () => {
    const { userId, fileId } = await seedProjectWithFile('текст\n');
    const update = await clientUpdate(fileId, (t) => t.delete(0, 1));
    expect((await applyYjsUpdate({ fileId, update, authorId: userId })).changed).toBe(true);
    // Тот же апдейт второй раз — документ уже в этом состоянии.
    expect((await applyYjsUpdate({ fileId, update, authorId: userId })).changed).toBe(false);
  });
});
