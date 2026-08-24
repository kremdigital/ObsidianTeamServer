// @vitest-environment node
/**
 * Уборка опустевших каталогов.
 *
 * Папки в вальте виртуальные — каталог живёт ровно потому, что в нём лежит
 * файл. Пока уборки не было, удаление и переименование оставляли скелеты:
 * через API невидимы, но копятся (в тестовом проекте на проде их набралось
 * больше десятка) и мешают по-настоящему — файл с именем такого каталога потом
 * не создать.
 */
import { mkdtemp, rm, readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteProjectFile, moveProjectFile, writeProjectFile } from './storage';
import { getProjectRoot } from './paths';

const PROJECT = 'proj-storage-test';
let storageRoot: string;
let originalStoragePath: string | undefined;

beforeAll(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'osync-storage-'));
  originalStoragePath = process.env.STORAGE_PATH;
  process.env.STORAGE_PATH = storageRoot;
});

afterAll(async () => {
  if (originalStoragePath !== undefined) process.env.STORAGE_PATH = originalStoragePath;
  else delete process.env.STORAGE_PATH;
  await rm(storageRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(getProjectRoot(PROJECT), { recursive: true, force: true });
});

const abs = (p: string) => join(getProjectRoot(PROJECT), p);
const write = (p: string, body = 'текст') =>
  writeProjectFile(PROJECT, p, Buffer.from(body, 'utf8'));

describe('deleteProjectFile — уборка каталогов', () => {
  it('снимает опустевшую цепочку каталогов до корня проекта', async () => {
    await write('раздел/глава/сцена.md');
    expect(existsSync(abs('раздел/глава'))).toBe(true);

    await deleteProjectFile(PROJECT, 'раздел/глава/сцена.md');

    expect(existsSync(abs('раздел/глава'))).toBe(false);
    expect(existsSync(abs('раздел'))).toBe(false);
    // Корень проекта обязан уцелеть: без него сломается и запись, и обход.
    expect(existsSync(getProjectRoot(PROJECT))).toBe(true);
  });

  it('не трогает каталог, в котором остались файлы', async () => {
    await write('раздел/один.md');
    await write('раздел/два.md');

    await deleteProjectFile(PROJECT, 'раздел/один.md');

    expect(existsSync(abs('раздел'))).toBe(true);
    expect(await readdir(abs('раздел'))).toEqual(['два.md']);
  });

  it('останавливается на первом непустом предке', async () => {
    await write('раздел/глава/сцена.md');
    await write('раздел/оглавление.md');

    await deleteProjectFile(PROJECT, 'раздел/глава/сцена.md');

    expect(existsSync(abs('раздел/глава'))).toBe(false);
    expect(existsSync(abs('раздел/оглавление.md'))).toBe(true);
  });

  it('файл в корне удаляется, корень остаётся', async () => {
    await write('корневая.md');
    await deleteProjectFile(PROJECT, 'корневая.md');
    expect(existsSync(getProjectRoot(PROJECT))).toBe(true);
  });
});

describe('moveProjectFile — уборка каталогов источника', () => {
  it('снимает опустевший каталог, из которого файл ушёл', async () => {
    await write('откуда/сцена.md', 'содержимое');

    await moveProjectFile(PROJECT, 'откуда/сцена.md', 'куда/сцена.md');

    expect(existsSync(abs('откуда'))).toBe(false);
    expect(existsSync(abs('куда/сцена.md'))).toBe(true);
  });

  it('каталог назначения не страдает от уборки источника', async () => {
    // Перенос внутри одной ветки: `а/б/1.md` → `а/2.md`. Каталог `а` пустеть не
    // должен — в нём теперь лежит перенесённый файл.
    await write('а/б/1.md');

    await moveProjectFile(PROJECT, 'а/б/1.md', 'а/2.md');

    expect(existsSync(abs('а/б'))).toBe(false);
    expect(existsSync(abs('а/2.md'))).toBe(true);
  });

  it('уборка не мешает переносу, если каталог занят посторонним', async () => {
    await write('откуда/сцена.md');
    // Каталог с посторонним содержимым, которого нет в БД, — снимать нельзя.
    await mkdir(abs('откуда/чужое'), { recursive: true });
    await writeFile(abs('откуда/чужое/файл.bin'), Buffer.from([1, 2, 3]));

    await moveProjectFile(PROJECT, 'откуда/сцена.md', 'куда/сцена.md');

    expect(existsSync(abs('куда/сцена.md'))).toBe(true);
    expect(existsSync(abs('откуда/чужое/файл.bin'))).toBe(true);
  });
});
