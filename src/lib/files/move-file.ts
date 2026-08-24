import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { moveProjectFile } from '@/lib/files/storage';
import { recordRestMove } from '@/lib/sync/rest-write';

export type MoveOutcome =
  | { ok: true; fileId: string; path: string }
  | { ok: false; reason: 'not_found' | 'path_exists' };

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
