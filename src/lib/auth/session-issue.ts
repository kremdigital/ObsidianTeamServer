import { prisma } from '@/lib/db/client';
import type { UserRole } from '@prisma/client';
import { signAccessToken, signRefreshToken } from './jwt';

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export async function issueSession(opts: {
  userId: string;
  role: UserRole;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<IssuedSession> {
  const accessToken = await signAccessToken(opts.userId, opts.role);
  const refresh = await signRefreshToken(opts.userId);

  await prisma.refreshToken.create({
    data: {
      userId: opts.userId,
      tokenHash: refresh.tokenHash,
      expiresAt: refresh.expiresAt,
      ...(opts.ip ? { ip: opts.ip } : {}),
      ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
    },
  });

  return {
    accessToken,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
  };
}

export function readClientMeta(request: Request): { ip: string | null; userAgent: string | null } {
  const headers = request.headers;
  const forwardedFor = headers.get('x-forwarded-for');
  const ip = forwardedFor ? (forwardedFor.split(',')[0]?.trim() ?? null) : headers.get('x-real-ip');
  const userAgent = headers.get('user-agent');
  return { ip, userAgent };
}
