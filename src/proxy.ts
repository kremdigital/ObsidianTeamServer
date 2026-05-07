import { NextResponse, type NextRequest } from 'next/server';
import { verifyAccessToken } from '@/lib/auth/jwt-verify';

const ADMIN_PREFIX = /^\/admin(\/|$)/;

const PROTECTED_PREFIXES = [
  /^\/dashboard/,
  /^\/profile/,
  /^\/api-keys/,
  /^\/notifications/,
  /^\/projects(\/|$)/,
  ADMIN_PREFIX,
];

function pickToken(request: NextRequest): string | null {
  const cookie = request.cookies.get('osync_access')?.value;
  if (cookie) return cookie;
  const auth = request.headers.get('authorization');
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m ? (m[1] ?? null) : null;
}

function redirectToLogin(request: NextRequest): NextResponse {
  const url = new URL('/login', request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next && next !== '/') url.searchParams.set('next', next);
  return NextResponse.redirect(url);
}

export default async function proxy(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.pathname;

  const isAdmin = ADMIN_PREFIX.test(path);
  const isProtected = PROTECTED_PREFIXES.some((re) => re.test(path));
  if (!isProtected) return NextResponse.next();

  const token = pickToken(request);
  if (!token) return redirectToLogin(request);

  const payload = await verifyAccessToken(token);
  if (!payload) return redirectToLogin(request);

  if (isAdmin && payload.role !== 'SUPERADMIN') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Apply to everything except Next internals, static, public auth pages, and API routes
  // (API routes do their own auth via getCurrentUser / API-key middleware).
  matcher: [
    '/((?!_next/|favicon.ico|api/|public/|login|register|forgot-password|reset-password|verify-email|invite).*)',
  ],
};
