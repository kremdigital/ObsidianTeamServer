import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { errors } from '@/lib/http/errors';
import { authenticateRequest } from '@/lib/auth/authenticate';
import { canViewProject, loadProjectAccess } from '@/lib/auth/permissions';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; fileId: string }> },
): Promise<NextResponse> {
  const user = await authenticateRequest(request);
  if (!user) return errors.unauthorized();

  const { id, fileId } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return errors.notFound('Проект не найден');
  if (!canViewProject(user, access)) return errors.forbidden();

  const file = await prisma.vaultFile.findFirst({
    where: { id: fileId, projectId: id },
    select: { id: true },
  });
  if (!file) return errors.notFound('Файл не найден');

  const versions = await prisma.fileVersion.findMany({
    where: { fileId },
    select: {
      id: true,
      versionNumber: true,
      contentHash: true,
      authorId: true,
      message: true,
      createdAt: true,
      author: { select: { id: true, name: true, email: true } },
    },
    orderBy: { versionNumber: 'desc' },
  });

  return NextResponse.json({ versions });
}
