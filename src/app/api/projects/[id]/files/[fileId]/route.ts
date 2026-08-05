import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { Readable } from 'node:stream';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { prisma } from '@/lib/db/client';
import { errors, parseJsonBody } from '@/lib/http/errors';
import { authenticateRequest, getMaxFileSize } from '@/lib/auth/authenticate';
import { canEditFiles, canViewProject, loadProjectAccess } from '@/lib/auth/permissions';
import { readProjectFileStream } from '@/lib/files/storage';
import { sha256OfBuffer } from '@/lib/files/hash';
import { recordFileVersion } from '@/lib/files/versioning';
import { corsPreflight, withCors } from '@/lib/http/cors';

interface RouteContext {
  params: Promise<{ id: string; fileId: string }>;
}

export async function OPTIONS(request: Request): Promise<Response> {
  return corsPreflight(request);
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const user = await authenticateRequest(request);
  if (!user) return withCors(errors.unauthorized(), request);

  const { id, fileId } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return withCors(errors.notFound('Проект не найден'), request);
  if (!canViewProject(user, access)) return withCors(errors.forbidden(), request);

  const file = await prisma.vaultFile.findFirst({
    where: { id: fileId, projectId: id, deletedAt: null },
    select: { path: true, mimeType: true, size: true },
  });
  if (!file) return withCors(errors.notFound('Файл не найден'), request);

  const stream = readProjectFileStream(id, file.path);
  const webStream = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
  return withCors(
    new Response(webStream, {
      status: 200,
      headers: {
        'content-type': file.mimeType ?? 'application/octet-stream',
        'content-length': file.size.toString(),
      },
    }),
    request,
  );
}

export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  const user = await authenticateRequest(request);
  if (!user) return errors.unauthorized();

  const { id, fileId } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return errors.notFound('Проект не найден');
  if (!canEditFiles(user, access)) return errors.forbidden();

  const file = await prisma.vaultFile.findFirst({
    where: { id: fileId, projectId: id },
    select: { path: true, deletedAt: true, fileType: true },
  });
  if (!file || file.deletedAt) return errors.notFound('Файл не найден');

  const buffer = Buffer.from(await request.arrayBuffer());
  const max = getMaxFileSize();
  if (max !== null && buffer.byteLength > max) {
    return errors.invalid('file_too_large', `Файл больше ${max} байт`);
  }

  // Через общий механизм: запись на диск, журнал операций, пересборка Yjs для
  // текста и рассылка клиентам. Прямая запись мимо него оставляла CRDT со
  // старым текстом — клиент получал устаревшее содержимое и возвращал его назад.
  const { applyRestOperation } = await import('@/lib/sync/rest-write');
  const contentHash = sha256OfBuffer(buffer);
  await applyRestOperation({
    projectId: id,
    userId: user.id,
    fileType: file.fileType,
    ...(file.fileType === 'TEXT' ? { textContent: buffer.toString('utf8') } : {}),
    op: {
      opType: 'UPDATE',
      filePath: file.path,
      payload: { fileId, contentHash, size: buffer.byteLength },
      data: buffer,
    },
  });

  const updated = await prisma.vaultFile.findUniqueOrThrow({
    where: { id: fileId },
    select: {
      id: true,
      path: true,
      fileType: true,
      contentHash: true,
      size: true,
      mimeType: true,
      updatedAt: true,
    },
  });

  await recordFileVersion({
    projectId: id,
    fileId,
    data: buffer,
    contentHash,
    authorId: user.id,
  });

  return NextResponse.json({ file: { ...updated, size: updated.size.toString() } });
}

const moveSchema = z.object({
  newPath: z.string().min(1),
});

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const user = await authenticateRequest(request);
  if (!user) return errors.unauthorized();

  const { id, fileId } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return errors.notFound('Проект не найден');
  if (!canEditFiles(user, access)) return errors.forbidden();

  const parsed = await parseJsonBody(request, moveSchema);
  if (!parsed.ok) return parsed.response;

  const file = await prisma.vaultFile.findFirst({
    where: { id: fileId, projectId: id, deletedAt: null },
    select: { path: true },
  });
  if (!file) return errors.notFound('Файл не найден');

  const { moveProjectFile } = await import('@/lib/files/storage');
  const { InvalidPathError, normalizeVaultPath } = await import('@/lib/files/paths');

  let normalizedNew: string;
  try {
    normalizedNew = normalizeVaultPath(parsed.data.newPath);
  } catch (err) {
    if (err instanceof InvalidPathError) {
      return errors.invalid('invalid_path', err.message);
    }
    throw err;
  }

  if (file.path === normalizedNew) {
    return NextResponse.json({ file: { id: fileId, path: normalizedNew } });
  }

  // Занятость целевого пути проверяем ДО того, как тронуть диск.
  //
  // `moveProjectFile` — это `rename(src, dst)`, а POSIX `rename` молча затирает
  // назначение. Раньше перенос выполнялся первым, и при конфликте содержимое
  // файла-назначения уничтожалось, а следом падало обновление БД (`P2002`,
  // необработанный → HTTP 500): диск и БД расходились, обе заметки переставали
  // читаться. Поэтому: сначала отказ, диск не трогаем.
  //
  // Тумбстоуны считаются занятыми: `@@unique([projectId, path])` покрывает и
  // удалённые строки, так что путь мягко удалённого файла переиспользовать
  // нельзя — то же поведение, что у `POST /files`.
  const occupant = await prisma.vaultFile.findUnique({
    where: { projectId_path: { projectId: id, path: normalizedNew } },
    select: { id: true },
  });
  if (occupant && occupant.id !== fileId) {
    return errors.conflict('path_exists', 'Файл с таким путём уже существует');
  }

  // Диск двигаем внутри транзакции: сбой переноса откатывает и запись в БД,
  // поэтому несогласованного состояния не остаётся ни при одном из исходов.
  //
  // Здесь применяется не `applyRestOperation`, а прямое обновление: сокетный
  // `applyMove` при коллизии уводит файл в `<path>.conflict-<clientId>`, что
  // для явного вызова API неверно (нужен отказ). Журнал и рассылка добавляются
  // ниже отдельно — операция должна дойти до клиентов так же, как остальные.
  let updated: { id: string; path: string };
  try {
    updated = await prisma.$transaction(async (tx) => {
      const row = await tx.vaultFile.update({
        where: { id: fileId },
        data: { path: normalizedNew, lastModifiedById: user.id },
        select: { id: true, path: true },
      });
      await moveProjectFile(id, file.path, normalizedNew);
      return row;
    });
  } catch (err) {
    // Страховка от гонки: между проверкой выше и обновлением путь мог занять
    // параллельный запрос.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return errors.conflict('path_exists', 'Файл с таким путём уже существует');
    }
    throw err;
  }

  // Журнал + рассылка. Диск и БД уже согласованы, поэтому ошибка здесь не
  // должна отменять успешное перемещение — худшее следствие в том, что клиент
  // узнает о нём при следующей полной сверке.
  const { recordRestMove } = await import('@/lib/sync/rest-write');
  await recordRestMove({
    projectId: id,
    userId: user.id,
    fileId,
    fromPath: file.path,
    toPath: normalizedNew,
  }).catch(() => undefined);

  return NextResponse.json({ file: updated });
}

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const user = await authenticateRequest(_request);
  if (!user) return errors.unauthorized();

  const { id, fileId } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return errors.notFound('Проект не найден');
  if (!canEditFiles(user, access)) return errors.forbidden();

  const file = await prisma.vaultFile.findFirst({
    where: { id: fileId, projectId: id },
    select: { path: true, deletedAt: true },
  });
  if (!file) return errors.notFound('Файл не найден');

  if (!file.deletedAt) {
    // Через общий механизм: мягкое удаление, снятие файла с диска, запись в
    // журнал и рассылка клиентам. Раньше удаление правило БД напрямую и до
    // подключённых клиентов не доходило.
    const { applyRestOperation } = await import('@/lib/sync/rest-write');
    await applyRestOperation({
      projectId: id,
      userId: user.id,
      op: { opType: 'DELETE', filePath: file.path, payload: { fileId } },
    });
  }

  return NextResponse.json({ success: true });
}

// Suppress the unused import warning for ReadableStream from web stream types.
void NodeReadableStream;
