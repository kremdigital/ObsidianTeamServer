import { cookies, headers } from 'next/headers';
import { prisma } from '@/lib/db/client';
import type { User, UserRole } from '@prisma/client';
import { verifyAccessToken } from './jwt';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  emailVerified: Date | null;
  language: string;
}

export const REFRESH_COOKIE_NAME = 'osync_refresh';

function pickAccessToken(
  authHeader: string | null,
  accessCookie: string | undefined,
): string | null {
  if (authHeader) {
    const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (m) return m[1] ?? null;
  }
  return accessCookie ?? null;
}

export async function getCurrentSessionUserId(): Promise<string | null> {
  const [headerStore, cookieStore] = await Promise.all([headers(), cookies()]);
  const token = pickAccessToken(
    headerStore.get('authorization'),
    cookieStore.get('osync_access')?.value,
  );
  if (!token) return null;
  const payload = await verifyAccessToken(token);
  return payload?.sub ?? null;
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const id = await getCurrentSessionUserId();
  if (!id) return null;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return null;
  return toSessionUser(user);
}

export function toSessionUser(user: User): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerified: user.emailVerified,
    language: user.language,
  };
}
