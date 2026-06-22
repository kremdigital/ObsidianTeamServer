import { Readable } from 'node:stream';
import { prisma } from '@/lib/db/client';
import { errors } from '@/lib/http/errors';
import { authenticateRequest } from '@/lib/auth/authenticate';
import { canViewProject, loadProjectAccess } from '@/lib/auth/permissions';
import { readVersionSnapshotStream } from '@/lib/files/storage';
import { corsPreflight, withCors } from '@/lib/http/cors';

export async function OPTIONS(request: Request): Promise<Response> {
  return corsPreflight(request);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; fileId: string; versionId: string }> },
): Promise<Response> {
  const user = await authenticateRequest(request);
  if (!user) return withCors(errors.unauthorized(), request);

  const { id, fileId, versionId } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return withCors(errors.notFound('Проект не найден'), request);
  if (!canViewProject(user, access)) return withCors(errors.forbidden(), request);

  const version = await prisma.fileVersion.findFirst({
    where: { id: versionId, fileId, file: { projectId: id } },
    select: { versionNumber: true, contentHash: true },
  });
  if (!version) return withCors(errors.notFound('Версия не найдена'), request);

  const stream = readVersionSnapshotStream(id, fileId, version.versionNumber);
  const webStream = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
  return withCors(
    new Response(webStream, {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'x-content-hash': version.contentHash,
      },
    }),
    request,
  );
}
