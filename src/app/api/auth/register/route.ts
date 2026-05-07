import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { Prisma, type User } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { errors, parseJsonBody } from '@/lib/http/errors';
import { hashPassword } from '@/lib/auth/password';
import { registerSchema } from '@/lib/auth/schemas';
import { sendMail, verifyEmailMessage } from '@/lib/email';
import { withApiLogger } from '@/lib/logger/http';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

export const POST = withApiLogger(async function POST(request: Request): Promise<NextResponse> {
  const parsed = await parseJsonBody(request, registerSchema);
  if (!parsed.ok) return parsed.response;

  const { email: rawEmail, password, name, inviteToken } = parsed.data;
  const email = rawEmail.trim().toLowerCase();

  const allowed = await isRegistrationAllowed(email, inviteToken);
  if (!allowed.ok) return allowed.response;

  const passwordHash = await hashPassword(password);
  const verifyToken = randomBytes(32).toString('hex');

  let user: User;
  try {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email, passwordHash, name, role: 'USER' },
      });

      await tx.emailVerificationToken.create({
        data: {
          userId: created.id,
          token: verifyToken,
          expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
        },
      });

      if (allowed.invitation) {
        await tx.serverInvitation.update({
          where: { id: allowed.invitation.id },
          data: { acceptedAt: new Date() },
        });
      }

      return created;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return errors.conflict('email_taken', 'Этот email уже зарегистрирован');
    }
    throw err;
  }

  await sendMail(verifyEmailMessage({ to: user.email, name: user.name, token: verifyToken }));

  return NextResponse.json({ id: user.id, email: user.email, name: user.name }, { status: 201 });
});

type AllowResult =
  | { ok: true; invitation: { id: string } | null }
  | { ok: false; response: NextResponse };

async function isRegistrationAllowed(
  email: string,
  inviteToken: string | undefined,
): Promise<AllowResult> {
  if (inviteToken) {
    const invite = await prisma.serverInvitation.findUnique({ where: { token: inviteToken } });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      return {
        ok: false,
        response: errors.invalid('invalid_invite', 'Приглашение недействительно'),
      };
    }
    if (invite.email.toLowerCase() !== email) {
      return {
        ok: false,
        response: errors.invalid('invite_email_mismatch', 'Email не совпадает с приглашением'),
      };
    }
    return { ok: true, invitation: { id: invite.id } };
  }

  const cfg = await prisma.serverConfig.findUnique({ where: { key: 'openRegistration' } });
  const open = cfg?.value === true;
  if (!open) {
    return { ok: false, response: errors.forbidden('Регистрация закрыта. Требуется приглашение.') };
  }
  return { ok: true, invitation: null };
}
