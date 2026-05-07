import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { errors, parseJsonBody } from '@/lib/http/errors';
import { resetPasswordSchema } from '@/lib/auth/schemas';
import { hashPassword } from '@/lib/auth/password';

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = await parseJsonBody(request, resetPasswordSchema);
  if (!parsed.ok) return parsed.response;

  const tokenRow = await prisma.passwordResetToken.findUnique({
    where: { token: parsed.data.token },
  });

  if (!tokenRow || tokenRow.usedAt || tokenRow.expiresAt < new Date()) {
    return errors.invalid('invalid_token', 'Ссылка недействительна или истекла');
  }

  const passwordHash = await hashPassword(parsed.data.password);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: tokenRow.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: tokenRow.id },
      data: { usedAt: new Date() },
    }),
    // Revoke all active refresh tokens — force re-login everywhere.
    prisma.refreshToken.updateMany({
      where: { userId: tokenRow.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  return NextResponse.json({ success: true });
}
