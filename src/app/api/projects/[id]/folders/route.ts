import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { errors, parseJsonBody } from '@/lib/http/errors';
import { authenticateRequest } from '@/lib/auth/authenticate';
import { canEditFiles, loadProjectAccess } from '@/lib/auth/permissions';
import { InvalidPathError, normalizeVaultPath } from '@/lib/files/paths';
import { moveVaultFile } from '@/lib/files/move-file';
import { applyRestOperation } from '@/lib/sync/rest-write';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Папки в вальте — виртуальные: отдельной сущности нет, есть только префикс в
 * пути файла. Поэтому операция над папкой разворачивается в операции над
 * каждым её файлом, включая вложенные.
 *
 * Делать это на клиенте (у него есть весь список) было бы проще, но на папке
 * вроде `раскадровки/серия-1` это сотни запросов и частичный результат при
 * первом же сбое. Здесь — один запрос и общая проверка до первого изменения.
 */
const renameSchema = z.object({
  path: z.string().min(1),
  newPath: z.string().min(1),
});

/** Файлы папки: сам префикс плюс всё вложенное, только живые. */
async function childrenOf(projectId: string, folder: string) {
  return prisma.vaultFile.findMany({
    where: { projectId, deletedAt: null, path: { startsWith: `${folder}/` } },
    select: { id: true, path: true },
    orderBy: { path: 'asc' },
  });
}

function normalizeFolder(raw: string): string | null {
  try {
    // `normalizeVaultPath` рассчитан на файлы, но проверки те же: без ведущего
    // слэша, без `..`, без выхода за корень. Хвостовой слэш срезаем сами.
    return normalizeVaultPath(raw.replace(/\/+$/, ''));
  } catch (err) {
    if (err instanceof InvalidPathError) return null;
    throw err;
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const user = await authenticateRequest(request);
  if (!user) return errors.unauthorized();

  const { id } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return errors.notFound('Проект не найден');
  if (!canEditFiles(user, access)) return errors.forbidden();

  const parsed = await parseJsonBody(request, renameSchema);
  if (!parsed.ok) return parsed.response;

  const from = normalizeFolder(parsed.data.path);
  const to = normalizeFolder(parsed.data.newPath);
  if (!from || !to) return errors.invalid('invalid_path', 'Недопустимый путь папки');
  if (from === to) return NextResponse.json({ path: to, moved: 0 });

  // Папка внутрь себя — путь вида `a` → `a/b`. Перенос затёр бы сам себя на
  // полпути, поэтому отказываем сразу.
  if (to.startsWith(`${from}/`)) {
    return errors.invalid('invalid_path', 'Нельзя переместить папку внутрь себя');
  }

  const files = await childrenOf(id, from);
  if (files.length === 0) return errors.notFound('Папка пуста или не найдена');

  // Все целевые пути проверяем ДО первого переноса: частично переименованная
  // папка хуже честного отказа.
  const targets = files.map((f) => ({ ...f, to: `${to}/${f.path.slice(from.length + 1)}` }));
  const occupied = await prisma.vaultFile.findMany({
    where: { projectId: id, deletedAt: null, path: { in: targets.map((t) => t.to) } },
    select: { path: true },
  });
  if (occupied.length > 0) {
    return errors.conflict(
      'path_exists',
      `Путь уже занят: ${occupied.map((o) => o.path).join(', ')}`,
    );
  }

  const failed: string[] = [];
  for (const t of targets) {
    const res = await moveVaultFile({
      projectId: id,
      userId: user.id,
      fileId: t.id,
      toPath: t.to,
    });
    if (!res.ok) failed.push(t.path);
  }

  return NextResponse.json({ path: to, moved: targets.length - failed.length, failed });
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  const user = await authenticateRequest(request);
  if (!user) return errors.unauthorized();

  const { id } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return errors.notFound('Проект не найден');
  if (!canEditFiles(user, access)) return errors.forbidden();

  const raw = new URL(request.url).searchParams.get('path');
  const folder = raw ? normalizeFolder(raw) : null;
  if (!folder) return errors.invalid('invalid_path', 'Недопустимый путь папки');

  const files = await childrenOf(id, folder);
  if (files.length === 0) return errors.notFound('Папка пуста или не найдена');

  // Через общий механизм: мягкое удаление, снятие файла с диска, журнал и
  // рассылка клиентам — как у одиночного удаления.
  for (const f of files) {
    await applyRestOperation({
      projectId: id,
      userId: user.id,
      op: { opType: 'DELETE', filePath: f.path, payload: { fileId: f.id } },
    });
  }

  return NextResponse.json({ path: folder, deleted: files.length });
}
