import { randomBytes } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { getProjectRoot, getStagingPath, getVersionPath, resolveProjectFile } from './paths';
import { sha256OfBuffer, sha256OfFile } from './hash';

export interface FileStat {
  size: number;
  mtimeMs: number;
}

export interface ListedFile {
  /** Vault-relative path with forward slashes. */
  path: string;
  size: number;
  mtimeMs: number;
}

/**
 * На пути файла стоит НЕПУСТОЙ каталог: файл и папка с одним именем на диске
 * не уживаются. Отдельный тип, чтобы вызывающий отдал внятный 409, а не ронял
 * запрос пустым 500 с `EISDIR` в логе.
 */
export class PathIsDirectoryError extends Error {
  constructor(public readonly vaultPath: string) {
    super(`Путь «${vaultPath}» занят папкой`);
    this.name = 'PathIsDirectoryError';
  }
}

/**
 * Убрать каталог, стоящий ровно на месте будущего файла.
 *
 * Пустой каталог — это мусор: папки в вальте виртуальны, каталог без файлов не
 * значит ничего. Такие скелеты копились годами (на проде их набралось 139 в
 * одном вальте) и делали путь незаписываемым — `rename` во время атомарной
 * записи получал `EISDIR`, и наружу уходил пустой 500. Снимаем по требованию:
 * это чинит и уже накопившееся, без отдельной миграции.
 *
 * Непустой каталог — настоящая коллизия, и её решает не файловая система, а
 * пользователь: сообщаем типизированной ошибкой.
 */
async function clearEmptyDirectoryAt(target: string, vaultPath: string): Promise<void> {
  let info;
  try {
    info = await stat(target);
  } catch {
    return; // пути нет — записи ничего не мешает
  }
  if (!info.isDirectory()) return;
  try {
    await rmdir(target); // сработает только если каталог пуст
  } catch {
    throw new PathIsDirectoryError(vaultPath);
  }
}

/**
 * Одна повторная попытка, если каталог-родитель исчез между `mkdir` и записью.
 *
 * Такое окно есть по-настоящему: уборка пустых каталогов (`pruneEmptyParents`)
 * работает параллельно и может снять каталог, который только что опустел, ровно
 * между созданием и записью. Порчи данных это не даёт, но роняло бы запрос
 * `ENOENT` на операции, которая просто просит повторить.
 */
async function withParentRetry<T>(target: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    await mkdir(dirname(target), { recursive: true });
    return await run();
  }
}

/** Ошибки ФС, означающие «на этом пути уже есть каталог». */
function isDirectoryCollision(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === 'EISDIR' || code === 'ENOTEMPTY' || code === 'EPERM';
}

/**
 * Atomically write a file (write to temp + rename). Creates parent dirs as needed.
 */
export async function writeProjectFile(
  projectId: string,
  vaultPath: string,
  data: Buffer | Uint8Array,
): Promise<{ size: number; contentHash: string }> {
  const target = resolveProjectFile(projectId, vaultPath);
  await clearEmptyDirectoryAt(target, vaultPath);

  await withParentRetry(target, async () => {
    await mkdir(dirname(target), { recursive: true });
    const tempPath = `${target}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(tempPath, data);
    try {
      await rename(tempPath, target);
    } catch (err) {
      await rm(tempPath, { force: true });
      // Каталог мог появиться на этом пути уже после проверки.
      if (isDirectoryCollision(err)) throw new PathIsDirectoryError(vaultPath);
      throw err;
    }
  });

  return { size: data.byteLength, contentHash: sha256OfBuffer(data) };
}

export function readProjectFileStream(projectId: string, vaultPath: string): ReadStream {
  const target = resolveProjectFile(projectId, vaultPath);
  return createReadStream(target);
}

/** Read the entire file as a Buffer. Used by lazy Yjs seeding in
 *  `project:join` where we need the bytes synchronously to build the
 *  initial CRDT state. Streaming would only matter for very large
 *  files; the use case here is small markdown notes. */
export async function readProjectFile(projectId: string, vaultPath: string): Promise<Buffer> {
  const target = resolveProjectFile(projectId, vaultPath);
  return readFile(target);
}

export async function getProjectFileStat(
  projectId: string,
  vaultPath: string,
): Promise<FileStat | null> {
  const target = resolveProjectFile(projectId, vaultPath);
  try {
    const s = await stat(target);
    return { size: s.size, mtimeMs: s.mtimeMs };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Снять опустевшие каталоги на пути файла, снизу вверх до корня проекта.
 *
 * Папки в вальте виртуальные — каталог существует ровно потому, что в нём
 * лежит файл. Удалив или унеся последний файл, мы оставляли каталог-скелет:
 * через API он невидим, но копится годами и мешает по-настоящему — файл с
 * именем такого каталога потом не создать (`writeFile` на каталог даёт
 * `EISDIR`).
 *
 * Работа необязательная: помеха — не ошибка, любой сбой глотаем (типично —
 * `ENOTEMPTY`, если в каталог уже что-то положили).
 *
 * Обратная сторона гонки закрыта у писателя, а не здесь: `withParentRetry`
 * пересоздаёт каталог и повторяет запись, если уборка успела снять его между
 * `mkdir` и `writeFile`.
 */
async function pruneEmptyParents(projectId: string, vaultPath: string): Promise<void> {
  const root = getProjectRoot(projectId);
  let dir = dirname(resolveProjectFile(projectId, vaultPath));
  // Корень проекта не трогаем: без него сломается и запись, и обход.
  while (dir !== root && dir.startsWith(root + sep)) {
    try {
      await rmdir(dir);
    } catch {
      return;
    }
    dir = dirname(dir);
  }
}

export async function deleteProjectFile(projectId: string, vaultPath: string): Promise<void> {
  const target = resolveProjectFile(projectId, vaultPath);
  await unlink(target).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err;
  });
  await pruneEmptyParents(projectId, vaultPath);
}

export async function moveProjectFile(
  projectId: string,
  fromPath: string,
  toPath: string,
): Promise<void> {
  const src = resolveProjectFile(projectId, fromPath);
  const dst = resolveProjectFile(projectId, toPath);
  if (src === dst) return;
  // Пустой каталог-скелет на месте назначения не помеха, непустой — коллизия.
  await clearEmptyDirectoryAt(dst, toPath);
  await withParentRetry(dst, async () => {
    await mkdir(dirname(dst), { recursive: true });
    try {
      await rename(src, dst);
    } catch (err) {
      if (isDirectoryCollision(err)) throw new PathIsDirectoryError(toPath);
      throw err;
    }
  });
  // Каталог, из которого файл ушёл, мог опустеть — снимаем его так же, как при
  // удалении. Строго ПОСЛЕ переноса: до него каталог ещё занят.
  await pruneEmptyParents(projectId, fromPath);
}

export async function listProjectFiles(projectId: string): Promise<ListedFile[]> {
  const root = getProjectRoot(projectId);
  const result: ListedFile[] = [];

  async function walk(absDir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      if (entry.name === '.versions' || entry.name === '.staging') continue;
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        const s = await stat(abs);
        const rel = relative(root, abs).split(sep).join('/');
        result.push({ path: rel, size: s.size, mtimeMs: s.mtimeMs });
      }
    }
  }

  await walk(root);
  return result;
}

/** Compute SHA-256 of a project file (streaming, suitable for large files). */
export async function hashProjectFile(projectId: string, vaultPath: string): Promise<string> {
  return sha256OfFile(resolveProjectFile(projectId, vaultPath));
}

/**
 * Snapshot the current file content into `.versions/<fileId>/<versionNumber>.snapshot`.
 */
export async function writeVersionSnapshot(
  projectId: string,
  fileId: string,
  versionNumber: number,
  data: Buffer | Uint8Array,
): Promise<string> {
  const target = getVersionPath(projectId, fileId, versionNumber);
  await mkdir(dirname(target), { recursive: true });
  const tempPath = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tempPath, data);
  try {
    await rename(tempPath, target);
  } catch (err) {
    await rm(tempPath, { force: true });
    throw err;
  }
  // Return path relative to the storage root for portability.
  return relative(getProjectRoot(projectId), target).split(sep).join('/');
}

export function readVersionSnapshotStream(
  projectId: string,
  fileId: string,
  versionNumber: number,
): ReadStream {
  return createReadStream(getVersionPath(projectId, fileId, versionNumber));
}

// -- Staging area for out-of-band binary uploads ------------------------------
//
// Binary file bytes are uploaded over REST into the content-addressed staging
// area, then a metadata-only socket event tells the sync handler to consume
// them. This keeps large payloads off the Socket.IO channel. The blob is
// removed once the socket handler folds it into the vault (or by an orphan
// sweep if the follow-up event never arrives).

/** Atomically write a staged binary blob, keyed by its content hash. */
export async function writeStagedBlob(
  projectId: string,
  contentHash: string,
  data: Buffer | Uint8Array,
): Promise<{ size: number; contentHash: string }> {
  const target = getStagingPath(projectId, contentHash);
  await mkdir(dirname(target), { recursive: true });
  const tempPath = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tempPath, data);
  try {
    await rename(tempPath, target);
  } catch (err) {
    await rm(tempPath, { force: true });
    throw err;
  }
  return { size: data.byteLength, contentHash: sha256OfBuffer(data) };
}

/** Read a staged blob by content hash. Returns `null` when it isn't present. */
export async function readStagedBlob(
  projectId: string,
  contentHash: string,
): Promise<Buffer | null> {
  try {
    return await readFile(getStagingPath(projectId, contentHash));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Remove a staged blob. No-op if already gone. */
export async function deleteStagedBlob(projectId: string, contentHash: string): Promise<void> {
  await unlink(getStagingPath(projectId, contentHash)).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err;
  });
}
