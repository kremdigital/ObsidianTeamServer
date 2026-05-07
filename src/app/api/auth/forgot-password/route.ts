import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { parseJsonBody } from '@/lib/http/errors';
import { forgotPasswordSchema } from '@/lib/auth/schemas';
import { passwordResetMessage, sendMail } from '@/lib/email';

const RESET_TTL_MS = 60 * 60 * 1000;

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = await parseJsonBody(request, forgotPasswordSchema);
  if (!parsed.ok) return parsed.response;

  const email = parsed.data.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    const token = randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    });
    await sendMail(passwordResetMessage({ to: user.email, name: user.name, token }));
  }

  // Always return success to avoid leaking which emails are registered.
  return NextResponse.json({ success: true });
}
