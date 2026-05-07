import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { errors } from '@/lib/http/errors';
import { getCurrentUser } from '@/lib/auth/session';
import { canManageMembers, loadProjectAccess } from '@/lib/auth/permissions';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; token: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return errors.unauthorized();

  const { id, token } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return errors.notFound('Проект не найден');
  if (!canManageMembers(user, access)) return errors.forbidden();

  const result = await prisma.projectInvitation.deleteMany({
    where: { projectId: id, token, acceptedAt: null },
  });
  if (result.count === 0) {
    return errors.notFound('Приглашение не найдено');
  }
  return NextResponse.json({ success: true });
}
