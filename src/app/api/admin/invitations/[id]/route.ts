import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { errors } from '@/lib/http/errors';
import { requireSuperAdmin } from '@/lib/auth/admin';
import { readAuditClientMeta, recordAuditLog } from '@/lib/audit/record';

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  try {
    await prisma.serverInvitation.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return errors.notFound('Приглашение не найдено');
    }
    throw err;
  }

  const meta = readAuditClientMeta(request);
  await recordAuditLog({
    userId: auth.user.id,
    action: 'admin.invitation.revoke',
    entityType: 'ServerInvitation',
    entityId: id,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return NextResponse.json({ success: true });
}
