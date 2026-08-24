import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { moveProjectFile, PathIsDirectoryError } from '@/lib/files/storage';
import { recordRestMove } from '@/lib/sync/rest-write';

export type MoveOutcome =
  | { ok: true; fileId: string; path: string }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'path_exists' }
  /** Путь нельзя создать на диске. `blockedBy` — готовое объяснение для клиента. */
  | { ok: false; reason: 'path_blocked'; blockedBy: string };

/** Пути-предки: для `а/б/в.md` — `а` и `а/б`. Для файла в корне — пусто. */
export function ancestorPaths(path: string): string[] {
  const parts = path.split('/');
  parts.pop();
  const out: string[] = [];
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    out.push(acc);
  }
  return out;
}

/**
 * Живой файл, из-за которого `toPath` не получится создать на диске.
 *
 * Проверка занятости самого пути этого не ловит. Папки в вальте виртуальные —
 * в БД `а/б` (файл без расширения) и `а/б/в.md` спокойно уживаются, а на диске
 * `а/б` не может быть одновременно файлом и каталогом: `mkdir` получит
 * `EEXIST`. Именно так переименование папки в назначение, где лежал файл с
 * подходящим именем, разрывало папку пополам и отдавало пустой 500.
 *
 * Обратный случай симметричен: `toPath` — уже существующий каталог (под ним
 * есть живые файлы), и `rename(2)` файла на него даёт `EISDIR`/`ENOTEMPTY`.
 *
 * `ignoreFileIds` — файлы, которые сами участвуют в этом же переносе: они
 * освободят свои пути и помехой не являются.
 */
export interface PathBlocker {
  /** Живой файл, из-за которого путь недоступен. */
  path: string;
  /**
   * `file` — этот файл стоит на месте нужного каталога;
   * `folder` — он лежит ВНУТРИ пути, то есть путь уже занят папкой.
   */
  kind: 'file' | 'folder';
}

/** Человеческая формулировка отказа: без имени виновника он выглядит абсурдом. */
export function describeBlocker(blocker: PathBlocker): string {
  return blocker.kind === 'file'
    ? `Путь занят файлом «${blocker.path}» — на нём не создать папку`
    : `На этом пути папка: в ней лежит «${blocker.path}»`;
}

export async function findPathBlocker(
  projectId: string,
  toPath: string,
  ignoreFileIds: string[] = [],
): Promise<PathBlocker | null> {
  const exclude = ignoreFileIds.length > 0 ? { id: { notIn: ignoreFileIds } } : {};

  const ancestors = ancestorPaths(toPath);
  if (ancestors.length > 0) {
    const inTheWay = await prisma.vaultFile.findFirst({
      where: { projectId, deletedAt: null, path: { in: ancestors }, ...exclude },
      select: { path: true },
    });
    if (inTheWay) return { path: inTheWay.path, kind: 'file' };
  }

  const underTarget = await prisma.vaultFile.findFirst({
    where: { projectId, deletedAt: null, path: { startsWith: `${toPath}/` }, ...exclude },
    select: { path: true },
  });
  return underTarget ? { path: underTarget.path, kind: 'folder' } : null;
}

/**
 * То же для набора путей разом — одним запросом вместо двух на файл.
 *
 * Нужно переименованию папки: там проверить надо **все** назначения до первого
 * переноса, иначе отказ на середине оставляет папку разорванной пополам.
 * Проверяется только «файл на месте каталога» — обратный случай ловит
 * `findPathBlocker` внутри самого переноса.
 */
export async function findBatchPathBlocker(opts: {
  projectId: string;
  targets: string[];
  ignoreFileIds?: string[];
}): Promise<{ target: string; blockedBy: string } | null> {
  const { projectId, targets, ignoreFileIds = [] } = opts;

  const ancestors = new Set<string>();
  for (const target of targets) for (const a of ancestorPaths(target)) ancestors.add(a);
  if (ancestors.size === 0) return null;

  const inTheWay = await prisma.vaultFile.findMany({
    where: {
      projectId,
      deletedAt: null,
      path: { in: [...ancestors] },
      ...(ignoreFileIds.length > 0 ? { id: { notIn: ignoreFileIds } } : {}),
    },
    select: { path: true },
  });
  if (inTheWay.length === 0) return null;

  const blocked = new Set(inTheWay.map((f) => f.path));
  for (const target of targets) {
    for (const a of ancestorPaths(target)) {
      if (blocked.has(a)) return { target, blockedBy: a };
    }
  }
  return null;
}

/** «На этом пути уже что-то есть другого рода» — типизированно или кодом ФС. */
function isPathCollisionError(err: unknown): boolean {
  if (err instanceof PathIsDirectoryError) return true;
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === 'EEXIST' || code === 'EISDIR' || code === 'ENOTDIR' || code === 'ENOTEMPTY';
}

/**
 * Перенести один файл вальта: диск, БД, журнал операций и рассылка клиентам.
 *
 * Вынесено из `PATCH /files/[fileId]`, потому что тем же занимается
 * переименование папки — а логика здесь неочевидная, и две её копии разошлись бы.
 *
 * Порядок операций закреплён горьким опытом (см. инцидент 2026-08-03):
 * `moveProjectFile` — это `rename(2)`, который молча затирает назначение,
 * поэтому занятость проверяется ДО обращения к диску, а сам перенос идёт внутри
 * транзакции вместе с обновлением БД. Иначе сбой оставлял диск и БД
 * рассогласованными, а содержимое файла-назначения уничтожалось.
 */
export async function moveVaultFile(opts: {
  projectId: string;
  userId: string;
  fileId: string;
  toPath: string;
}): Promise<MoveOutcome> {
  const { projectId, userId, fileId, toPath } = opts;

  const file = await prisma.vaultFile.findFirst({
    where: { id: fileId, projectId, deletedAt: null },
    select: { path: true },
  });
  if (!file) return { ok: false, reason: 'not_found' };
  if (file.path === toPath) return { ok: true, fileId, path: toPath };

  // Конфликтом считается только ЖИВОЙ файл. Тумбстоун путь не держит: `POST
  // /files` на такой путь оживляет запись, и перенос обязан вести себя так же.
  const occupant = await prisma.vaultFile.findUnique({
    where: { projectId_path: { projectId, path: toPath } },
    select: { id: true, deletedAt: true },
  });
  if (occupant && occupant.id !== fileId && occupant.deletedAt === null) {
    return { ok: false, reason: 'path_exists' };
  }

  const blocker = await findPathBlocker(projectId, toPath, [fileId]);
  if (blocker) return { ok: false, reason: 'path_blocked', blockedBy: describeBlocker(blocker) };

  // Мёртвую строку уводим на служебный путь, а не удаляем: так сохраняются её
  // версии и история, а `purge-tombstones` уберёт её штатно.
  const tombstoneToFree = occupant && occupant.id !== fileId ? occupant.id : null;

  try {
    await prisma.$transaction(async (tx) => {
      if (tombstoneToFree) {
        await tx.vaultFile.update({
          where: { id: tombstoneToFree },
          data: { path: `${toPath}.tombstone-${tombstoneToFree}` },
        });
      }
      await tx.vaultFile.update({
        where: { id: fileId },
        data: { path: toPath, lastModifiedById: userId },
      });
      await moveProjectFile(projectId, file.path, toPath);
    });
  } catch (err) {
    // Страховка от гонки: между проверкой и обновлением путь мог занять
    // параллельный запрос.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, reason: 'path_exists' };
    }
    // Диск способен отказать и после проверок: пустой каталог, оставшийся от
    // прежних операций, гонка, правка хранилища руками. Транзакция откатилась,
    // БД цела — отвечаем отказом, а не пустым 500 с исключением наружу.
    if (isPathCollisionError(err)) {
      return { ok: false, reason: 'path_blocked', blockedBy: `Путь «${toPath}» занят папкой` };
    }
    throw err;
  }

  // Журнал и рассылка. Диск и БД уже согласованы, поэтому сбой здесь не должен
  // отменять выполненный перенос — худшее следствие в том, что клиент узнает о
  // нём при следующей полной сверке.
  await recordRestMove({
    projectId,
    userId,
    fileId,
    fromPath: file.path,
    toPath,
  }).catch(() => undefined);

  return { ok: true, fileId, path: toPath };
}
