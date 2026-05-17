import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { issueSession } from '@/lib/auth/session-issue';
import { verifyAccessToken } from '@/lib/auth/jwt';
import { resetDatabase, testPrisma } from '../db';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

/**
 * The login route itself is thin — it validates the password and calls
 * `issueSession`. We can't drive the route from a unit test because it
 * sets cookies via `next/headers`, which throws outside a request scope.
 * Test the contract that matters: `rememberMe` lives in the DB and the
 * access JWT carries it back to the verifier.
 */
async function makeUser() {
  return testPrisma.user.create({
    data: {
      email: `u-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: 'h',
      name: 'U',
      emailVerified: new Date(),
    },
  });
}

describe('issueSession — rememberMe handling', () => {
  it('defaults to rememberMe=false', async () => {
    const user = await makeUser();
    const session = await issueSession({ userId: user.id, role: user.role });
    const stored = await testPrisma.refreshToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.rememberMe).toBe(false);

    const payload = await verifyAccessToken(session.accessToken);
    expect(payload?.rememberMe).toBe(false);
  });

  it('persists rememberMe=true on the row + access JWT when explicitly set', async () => {
    const user = await makeUser();
    const session = await issueSession({
      userId: user.id,
      role: user.role,
      rememberMe: true,
    });
    const stored = await testPrisma.refreshToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.rememberMe).toBe(true);

    const payload = await verifyAccessToken(session.accessToken);
    expect(payload?.rememberMe).toBe(true);
  });

  it('refresh token expiry stays at the long TTL regardless of rememberMe', async () => {
    // The refresh cookie's window is already 30 d by default; the
    // contract for "Remember me" is to ALSO extend the access window so
    // the user stays signed in without a manual /auth/refresh call.
    const user = await makeUser();
    const a = await issueSession({ userId: user.id, role: user.role, rememberMe: false });
    const b = await issueSession({ userId: user.id, role: user.role, rememberMe: true });
    // Both refresh tokens use the same env-driven TTL.
    expect(Math.abs(a.refreshExpiresAt.getTime() - b.refreshExpiresAt.getTime())).toBeLessThan(
      2_000,
    );
  });
});
