import { prisma } from '@/lib/db/client';
import { hashJti, verifyRefreshToken } from '@/lib/auth/jwt';
import { issueSession, readClientMeta } from '@/lib/auth/session-issue';
import {
  clearAccessCookie,
  clearRefreshCookie,
  readRefreshCookie,
  setAccessCookie,
  setRefreshCookie,
} from '@/lib/auth/cookies';

export type RefreshFailure =
  | 'missing'
  | 'invalid'
  | 'unknown'
  | 'expired_or_revoked'
  | 'user_not_found';

export type RefreshResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: RefreshFailure };

const REASON_MESSAGES: Record<RefreshFailure, string> = {
  missing: 'Refresh token missing',
  invalid: 'Refresh token invalid',
  unknown: 'Refresh token unknown',
  expired_or_revoked: 'Refresh token expired or revoked',
  user_not_found: 'User not found',
};

export function refreshFailureMessage(reason: RefreshFailure): string {
  return REASON_MESSAGES[reason];
}

/**
 * Обменять refresh-cookie на новую пару токенов и переставить обе cookie.
 *
 * Вынесено из `POST /api/auth/refresh`, потому что тем же самым занимается
 * `GET /api/auth/session-refresh` — маршрут, на который `proxy` отправляет
 * пользователя с истёкшим access-токеном вместо страницы входа.
 *
 * Токены **ротируются**: текущий refresh отзывается, выдаётся новый. Поэтому
 * параллельные вызовы недопустимы — второй придёт с уже отозванным токеном и
 * получит `expired_or_revoked`. На клиенте за это отвечает дедупликация в
 * `lib/api/client`.
 *
 * При любой неудаче обе cookie снимаются: держать протухшую пару незачем, а
 * пользователю нужен честный переход на вход.
 */
export async function refreshSessionCookies(request: Request): Promise<RefreshResult> {
  const refresh = await readRefreshCookie();
  if (!refresh) return { ok: false, reason: 'missing' };

  const payload = await verifyRefreshToken(refresh);
  if (!payload) {
    await Promise.all([clearRefreshCookie(), clearAccessCookie()]);
    return { ok: false, reason: 'invalid' };
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashJti(payload.jti) },
  });
  if (!stored || stored.userId !== payload.sub) {
    await Promise.all([clearRefreshCookie(), clearAccessCookie()]);
    return { ok: false, reason: 'unknown' };
  }
  if (stored.revokedAt || stored.expiresAt < new Date()) {
    await Promise.all([clearRefreshCookie(), clearAccessCookie()]);
    return { ok: false, reason: 'expired_or_revoked' };
  }

  const user = await prisma.user.findUnique({ where: { id: stored.userId } });
  if (!user) {
    await Promise.all([clearRefreshCookie(), clearAccessCookie()]);
    return { ok: false, reason: 'user_not_found' };
  }

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });

  const meta = readClientMeta(request);
  // Решение «запомнить меня» переносится через ротацию, иначе длинная сессия
  // молча схлопнулась бы обратно до 15 минут на первом же обновлении.
  const rememberMe = stored.rememberMe;
  const session = await issueSession({
    userId: user.id,
    role: user.role,
    ip: meta.ip,
    userAgent: meta.userAgent,
    rememberMe,
  });

  await Promise.all([
    setRefreshCookie(session.refreshToken),
    setAccessCookie(session.accessToken, { rememberMe }),
  ]);

  return { ok: true, accessToken: session.accessToken };
}
