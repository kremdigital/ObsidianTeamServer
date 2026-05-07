import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { errors, parseJsonBody } from '@/lib/http/errors';
import { verifyEmailSchema } from '@/lib/auth/schemas';

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = await parseJsonBody(request, verifyEmailSchema);
  if (!parsed.ok) return parsed.response;

  const tokenRow = await prisma.emailVerificationToken.findUnique({
    where: { token: parsed.data.token },
  });
  if (!tokenRow || tokenRow.expiresAt < new Date()) {
    return errors.invalid('invalid_token', 'Ссылка недействительна или истекла');
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: tokenRow.userId },
      data: { emailVerified: new Date() },
    }),
    prisma.emailVerificationToken.delete({ where: { id: tokenRow.id } }),
  ]);

  return NextResponse.json({ success: true });
}
