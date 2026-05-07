import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { errors, parseJsonBody } from '@/lib/http/errors';
import { requireSuperAdmin } from '@/lib/auth/admin';
import { readAuditClientMeta, recordAuditLog } from '@/lib/audit/record';

const patchSchema = z.object({
  role: z.enum(['USER', 'SUPERADMIN']).optional(),
  disabled: z.boolean().optional(),
  emailVerified: z.boolean().optional(),
  name: z.string().trim().min(1).max(100).optional(),
});

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, ctx: Ctx): Promise<NextResponse> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      emailVerified: true,
      disabledAt: true,
      language: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { ownedProjects: true, memberships: true, apiKeys: true } },
    },
  });
  if (!user) return errors.notFound('Пользователь не найден');

  const auditLogs = await prisma.auditLog.findMany({
    where: { userId: id },
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      metadata: true,
      ip: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return NextResponse.json({ user, auditLogs });
}

export async function PATCH(request: Request, ctx: Ctx): Promise<NextResponse> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const parsed = await parseJsonBody(request, patchSchema);
  if (!parsed.ok) return parsed.response;

  const data: Prisma.UserUpdateInput = {};
  const audit: Record<string, unknown> = {};
  if (parsed.data.role !== undefined) {
    data.role = parsed.data.role;
    audit.role = parsed.data.role;
  }
  if (parsed.data.disabled !== undefined) {
    data.disabledAt = parsed.data.disabled ? new Date() : null;
    audit.disabled = parsed.data.disabled;
  }
  if (parsed.data.emailVerified !== undefined) {
    data.emailVerified = parsed.data.emailVerified ? new Date() : null;
    audit.emailVerified = parsed.data.emailVerified;
  }
  if (parsed.data.name !== undefined) {
    data.name = parsed.data.name;
    audit.name = parsed.data.name;
  }

  try {
    const updated = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        emailVerified: true,
        disabledAt: true,
      },
    });

    if (parsed.data.disabled === true) {
      await prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    const meta = readAuditClientMeta(request);
    await recordAuditLog({
      userId: auth.user.id,
      action: 'admin.user.update',
      entityType: 'User',
      entityId: id,
      metadata: audit as Prisma.InputJsonValue,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return NextResponse.json({ user: updated });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return errors.notFound('Пользователь не найден');
    }
    throw err;
  }
}

export async function DELETE(request: Request, ctx: Ctx): Promise<NextResponse> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;

  if (id === auth.user.id) {
    return errors.invalid('cannot_delete_self', 'Нельзя удалить собственный аккаунт');
  }

  try {
    await prisma.user.delete({ where: { id } });
    const meta = readAuditClientMeta(request);
    await recordAuditLog({
      userId: auth.user.id,
      action: 'admin.user.delete',
      entityType: 'User',
      entityId: id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return errors.notFound('Пользователь не найден');
      if (err.code === 'P2003' || err.code === 'P2014') {
        return errors.conflict(
          'has_owned_projects',
          'У пользователя есть проекты — сначала передайте владение или удалите их.',
        );
      }
    }
    throw err;
  }
}
