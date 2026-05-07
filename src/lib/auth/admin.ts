import type { NextResponse } from 'next/server';
import { errors } from '@/lib/http/errors';
import { getCurrentUser, type SessionUser } from './session';

/**
 * Returns the current SUPERADMIN user. Returns a `NextResponse` (401/403)
 * for non-superadmin requests; route handlers are expected to return that
 * response directly.
 */
export async function requireSuperAdmin(): Promise<
  { ok: true; user: SessionUser } | { ok: false; response: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, response: errors.unauthorized() };
  if (user.role !== 'SUPERADMIN') return { ok: false, response: errors.forbidden() };
  return { ok: true, user };
}
