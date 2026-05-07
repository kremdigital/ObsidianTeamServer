import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { errors, parseJsonBody } from '@/lib/http/errors';
import { verifyPassword } from '@/lib/auth/password';
import { loginSchema } from '@/lib/auth/schemas';
import { issueSession, readClientMeta } from '@/lib/auth/session-issue';
import { setAccessCookie, setRefreshCookie } from '@/lib/auth/cookies';
import { withApiLogger } from '@/lib/logger/http';

export const POST = withApiLogger(async function POST(request: Request): Promise<NextResponse> {
  const parsed = await parseJsonBody(request, loginSchema);
  if (!parsed.ok) return parsed.response;

  const email = parsed.data.email.trim().toLowerCase();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return errors.unauthorized('Неверный email или пароль');
  }

  const valid = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!valid) {
    return errors.unauthorized('Неверный email или пароль');
  }

  const meta = readClientMeta(request);
  const session = await issueSession({
    userId: user.id,
    role: user.role,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  await Promise.all([setRefreshCookie(session.refreshToken), setAccessCookie(session.accessToken)]);

  return NextResponse.json({
    accessToken: session.accessToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerified: user.emailVerified,
      language: user.language,
    },
  });
});
