import { prisma } from '@/lib/db/client';

/**
 * Whether self-service registration is currently allowed.
 *
 * Reads the `openRegistration` row from `serverConfig`. The value lives in
 * the DB so a super-admin can toggle it without redeploying. Returns
 * `false` if the row is missing or holds a non-true value — closed by
 * default, so a fresh install requires an explicit opt-in.
 *
 * UI surfaces (the login page's "Sign up" link, the register page itself)
 * and the `/api/auth/register` handler all branch off this single read so
 * the front-end and back-end stay in sync.
 */
export async function isOpenRegistration(): Promise<boolean> {
  const cfg = await prisma.serverConfig.findUnique({
    where: { key: 'openRegistration' },
    select: { value: true },
  });
  return cfg?.value === true;
}
