import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Readable } from 'node:stream';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { prisma } from '@/lib/db/client';
import { errors, parseJsonBody } from '@/lib/http/errors';
import { authenticateRequest, getMaxFileSize } from '@/lib/auth/authenticate';
import { canEditFiles, canViewProject, loadProjectAccess } from '@/lib/auth/permissions';
import { deleteProjectFile, readProjectFileStream, writeProjectFile } from '@/lib/files/storage';
import { recordFileVersion } from '@/lib/files/versioning';

interface RouteContext {
  params: Promise<{ id: string; fileId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const user = await authenticateRequest(request);
  if (!user) return errors.unauthorized();

  const { id, fileId } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return errors.notFound('Проект не найден');
  if (!canViewProject(user, access)) return errors.forbidden();

  const file = await prisma.vaultFile.findFirst({
    where: { id: fileId, projectId: id, deletedAt: null },
    select: { path: true, mimeType: true, size: true },
  });
  if (!file) return errors.notFound('Файл не найден');

  const stream = readProjectFileStream(id, file.path);
  const webStream = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
  return new Response(webStream, {
    status: 200,
    headers: {
      'content-type': file.mimeType ?? 'application/octet-stream',
      'content-length': file.size.toString(),
    },
  });
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
    select: { path: true, deletedAt: true },
  });
  if (!file || file.deletedAt) return errors.notFound('Файл не найден');

  const buffer = Buffer.from(await request.arrayBuffer());
  const max = getMaxFileSize();
  if (max !== null && buffer.byteLength > max) {
    return errors.invalid('file_too_large', `Файл больше ${max} байт`);
  }

  const written = await writeProjectFile(id, file.path, buffer);

  const updated = await prisma.vaultFile.update({
    where: { id: fileId },
    data: {
      contentHash: written.contentHash,
      size: BigInt(written.size),
      lastModifiedById: user.id,
    },
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
    contentHash: written.contentHash,
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

  // Validate new path; conflict check via unique index.
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

  await moveProjectFile(id, file.path, normalizedNew);
  const updated = await prisma.vaultFile.update({
    where: { id: fileId },
    data: { path: normalizedNew, lastModifiedById: user.id },
    select: { id: true, path: true },
  });

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
    await prisma.vaultFile.update({
      where: { id: fileId },
      data: { deletedAt: new Date(), lastModifiedById: user.id },
    });
    await deleteProjectFile(id, file.path).catch(() => undefined);
  }

  return NextResponse.json({ success: true });
}

// Suppress the unused import warning for ReadableStream from web stream types.
void NodeReadableStream;
