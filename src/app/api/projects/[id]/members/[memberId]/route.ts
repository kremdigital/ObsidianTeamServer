import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { errors, parseJsonBody } from '@/lib/http/errors';
import { getCurrentUser } from '@/lib/auth/session';
import { canManageMembers, loadProjectAccess } from '@/lib/auth/permissions';

const patchSchema = z.object({
  role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; memberId: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return errors.unauthorized();

  const { id, memberId } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return errors.notFound('Проект не найден');
  if (!canManageMembers(user, access)) return errors.forbidden();

  const parsed = await parseJsonBody(request, patchSchema);
  if (!parsed.ok) return parsed.response;

  const member = await prisma.projectMember.findFirst({
    where: { id: memberId, projectId: id },
    select: { userId: true },
  });
  if (!member) return errors.notFound('Участник не найден');

  if (member.userId === access.project.ownerId) {
    return errors.invalid('owner_role_immutable', 'Роль владельца проекта изменить нельзя');
  }

  const updated = await prisma.projectMember.update({
    where: { id: memberId },
    data: { role: parsed.data.role },
    select: {
      id: true,
      role: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({ member: updated });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; memberId: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return errors.unauthorized();

  const { id, memberId } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return errors.notFound('Проект не найден');
  if (!canManageMembers(user, access)) return errors.forbidden();

  const member = await prisma.projectMember.findFirst({
    where: { id: memberId, projectId: id },
    select: { userId: true },
  });
  if (!member) return errors.notFound('Участник не найден');

  if (member.userId === access.project.ownerId) {
    return errors.invalid('owner_immutable', 'Владельца проекта удалить нельзя');
  }

  await prisma.projectMember.delete({ where: { id: memberId } });
  return NextResponse.json({ success: true });
}
