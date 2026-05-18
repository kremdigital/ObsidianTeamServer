import { NextResponse, type NextRequest } from 'next/server';
import {
  type AccessTokenPayload,
  getAccessTtlSeconds,
  signAccessToken,
  verifyAccessToken,
} from '@/lib/auth/jwt';

const ACCESS_COOKIE_NAME = 'osync_access';
const isProd = process.env.NODE_ENV === 'production';

const ADMIN_PREFIX = /^\/admin(\/|$)/;

const PROTECTED_PREFIXES = [
  /^\/dashboard/,
  /^\/profile/,
  /^\/api-keys/,
  /^\/notifications/,
  /^\/projects(\/|$)/,
  ADMIN_PREFIX,
];

function pickToken(request: NextRequest): { token: string; fromCookie: boolean } | null {
  const cookie = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  if (cookie) return { token: cookie, fromCookie: true };
  const auth = request.headers.get('authorization');
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m && m[1] ? { token: m[1], fromCookie: false } : null;
}

function redirectToLogin(request: NextRequest): NextResponse {
  const url = new URL('/login', request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next && next !== '/') url.searchParams.set('next', next);
  return NextResponse.redirect(url);
}

/**
 * Slide a "Remember me" session's expiry forward when the user is past
 * the half-life of the JWT window. Re-issues the access token with a
 * fresh long TTL and resets the cookie's `maxAge` so auto-logout is
 * measured from the user's most recent visit instead of from login.
 *
 * Only applies to cookie-borne tokens — `Authorization: Bearer` flow
 * (the Obsidian plugin's API key) doesn't carry the rememberMe flag and
 * sliding it would have no effect anyway since the client never reads
 * `Set-Cookie`.
 *
 * The half-life threshold keeps `Set-Cookie` writes infrequent: with
 * the default 30 d TTL, a re-issue happens at most once per 15 d
 * window. The user still gets the "auto-logout 30 d from last visit"
 * UX as long as they're active within any 15 d stretch.
 */
async function slideRememberMe(
  payload: AccessTokenPayload,
  response: NextResponse,
  fromCookie: boolean,
): Promise<NextResponse> {
  if (!fromCookie || !payload.rememberMe) return response;
  const fullTtl = getAccessTtlSeconds(true);
  const remaining = payload.exp - Math.floor(Date.now() / 1000);
  if (remaining * 2 > fullTtl) return response;

  const fresh = await signAccessToken(payload.sub, payload.role, { rememberMe: true });
  response.cookies.set(ACCESS_COOKIE_NAME, fresh, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: fullTtl,
  });
  return response;
}

export default async function proxy(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.pathname;

  const isAdmin = ADMIN_PREFIX.test(path);
  const isProtected = PROTECTED_PREFIXES.some((re) => re.test(path));
  if (!isProtected) return NextResponse.next();

  const picked = pickToken(request);
  if (!picked) return redirectToLogin(request);

  const payload = await verifyAccessToken(picked.token);
  if (!payload) return redirectToLogin(request);

  if (isAdmin && payload.role !== 'SUPERADMIN') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return slideRememberMe(payload, NextResponse.next(), picked.fromCookie);
}

export const config = {
  // Apply to everything except Next internals, static, public auth pages, and API routes
  // (API routes do their own auth via getCurrentUser / API-key middleware).
  matcher: [
    '/((?!_next/|favicon.ico|api/|public/|login|register|forgot-password|reset-password|verify-email|invite).*)',
  ],
};
