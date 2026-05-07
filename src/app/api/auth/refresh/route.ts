import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { errors } from '@/lib/http/errors';
import { hashJti, verifyRefreshToken } from '@/lib/auth/jwt';
import { issueSession, readClientMeta } from '@/lib/auth/session-issue';
import {
  clearAccessCookie,
  clearRefreshCookie,
  readRefreshCookie,
  setAccessCookie,
  setRefreshCookie,
} from '@/lib/auth/cookies';

export async function POST(request: Request): Promise<NextResponse> {
  const refresh = await readRefreshCookie();
  if (!refresh) {
    return errors.unauthorized('Refresh token missing');
  }

  const payload = await verifyRefreshToken(refresh);
  if (!payload) {
    await Promise.all([clearRefreshCookie(), clearAccessCookie()]);
    return errors.unauthorized('Refresh token invalid');
  }

  const tokenHash = hashJti(payload.jti);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!stored || stored.userId !== payload.sub) {
    await Promise.all([clearRefreshCookie(), clearAccessCookie()]);
    return errors.unauthorized('Refresh token unknown');
  }
  if (stored.revokedAt || stored.expiresAt < new Date()) {
    await Promise.all([clearRefreshCookie(), clearAccessCookie()]);
    return errors.unauthorized('Refresh token expired or revoked');
  }

  const user = await prisma.user.findUnique({ where: { id: stored.userId } });
  if (!user) {
    await Promise.all([clearRefreshCookie(), clearAccessCookie()]);
    return errors.unauthorized('User not found');
  }

  // rotate: revoke current, issue new pair
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  const meta = readClientMeta(request);
  const session = await issueSession({
    userId: user.id,
    role: user.role,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  await Promise.all([setRefreshCookie(session.refreshToken), setAccessCookie(session.accessToken)]);

  return NextResponse.json({ accessToken: session.accessToken });
}
