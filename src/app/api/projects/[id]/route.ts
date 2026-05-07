import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { errors, parseJsonBody } from '@/lib/http/errors';
import { getCurrentUser } from '@/lib/auth/session';
import {
  canDeleteProject,
  canEditProjectMetadata,
  canViewProject,
  loadProjectAccess,
} from '@/lib/auth/permissions';

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  iconEmoji: z.string().max(8).nullable().optional(),
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

  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      iconEmoji: true,
      ownerId: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { members: true, files: true } },
    },
  });

  return NextResponse.json({ project, role: access.membership?.role ?? null });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return errors.unauthorized();

  const { id } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return errors.notFound('Проект не найден');
  if (!canEditProjectMetadata(user, access)) return errors.forbidden();

  const parsed = await parseJsonBody(request, patchSchema);
  if (!parsed.ok) return parsed.response;

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (parsed.data.iconEmoji !== undefined) data.iconEmoji = parsed.data.iconEmoji;

  const project = await prisma.project.update({
    where: { id },
    data,
    select: { id: true, slug: true, name: true, description: true, iconEmoji: true },
  });

  return NextResponse.json({ project });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return errors.unauthorized();

  const { id } = await context.params;
  const access = await loadProjectAccess(user, id);
  if (!access) return errors.notFound('Проект не найден');
  if (!canDeleteProject(user, access)) return errors.forbidden();

  await prisma.project.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
