import { Readable } from 'node:stream';
import { prisma } from '@/lib/db/client';
import { errors } from '@/lib/http/errors';
import { authenticateRequest } from '@/lib/auth/authenticate';
import { canViewProject, loadProjectAccess } from '@/lib/auth/permissions';
import { readVersionSnapshotStream } from '@/lib/files/storage';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; fileId: string; versionId: string }> },
): Promise<Response> {
  const user = await authenticateRequest(request);
  if (!user) return errors.unauthorized();

  const { id, fileId, versionId } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return errors.notFound('Проект не найден');
  if (!canViewProject(user, access)) return errors.forbidden();

  const version = await prisma.fileVersion.findFirst({
    where: { id: versionId, fileId, file: { projectId: id } },
    select: { versionNumber: true, contentHash: true },
  });
  if (!version) return errors.notFound('Версия не найдена');

  const stream = readVersionSnapshotStream(id, fileId, version.versionNumber);
  const webStream = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
  return new Response(webStream, {
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      'x-content-hash': version.contentHash,
    },
  });
}
