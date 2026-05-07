import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { errors, parseJsonBody } from '@/lib/http/errors';
import { getCurrentUser } from '@/lib/auth/session';
import { canManageMembers, canViewProject, loadProjectAccess } from '@/lib/auth/permissions';

const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return errors.unauthorized();

  const { id } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return errors.notFound('Проект не найден');
  if (!canViewProject(user, access)) return errors.forbidden();

  const members = await prisma.projectMember.findMany({
    where: { projectId: id },
    select: {
      id: true,
      role: true,
      addedAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { addedAt: 'asc' },
  });

  return NextResponse.json({ members });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return errors.unauthorized();

  const { id } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return errors.notFound('Проект не найден');
  if (!canManageMembers(user, access)) return errors.forbidden();

  const parsed = await parseJsonBody(request, addMemberSchema);
  if (!parsed.ok) return parsed.response;

  const target = await prisma.user.findUnique({
    where: { email: parsed.data.email.trim().toLowerCase() },
    select: { id: true },
  });
  if (!target) {
    return errors.notFound('Пользователь с таким email не найден');
  }

  try {
    const member = await prisma.projectMember.create({
      data: {
        projectId: id,
        userId: target.id,
        role: parsed.data.role,
        addedById: user.id,
      },
      select: {
        id: true,
        role: true,
        addedAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
    return NextResponse.json({ member }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return errors.conflict('member_exists', 'Пользователь уже участник проекта');
    }
    throw err;
  }
}
