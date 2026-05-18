// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { hashJti, signAccessToken, signRefreshToken } from './jwt';
import { verifyAccessToken, verifyRefreshToken } from './jwt-verify';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret';
  process.env.JWT_ACCESS_TTL = '15m';
  process.env.JWT_REFRESH_TTL = '30d';
});

describe('access token', () => {
  it('signs and verifies a valid access token (default short TTL)', async () => {
    const token = await signAccessToken('user-1', 'USER');
    const payload = await verifyAccessToken(token);
    expect(payload).toMatchObject({
      sub: 'user-1',
      role: 'USER',
      type: 'access',
      rememberMe: false,
    });
    expect(typeof payload?.exp).toBe('number');
  });

  it('carries the rememberMe flag through sign + verify', async () => {
    const token = await signAccessToken('user-1', 'USER', { rememberMe: true });
    const payload = await verifyAccessToken(token);
    expect(payload?.rememberMe).toBe(true);
  });

  it('exposes the JWT exp claim so the sliding proxy can read remaining life', async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await signAccessToken('user-1', 'USER', { rememberMe: true });
    const payload = await verifyAccessToken(token);
    // 30 d in the default env; allow ± 5 s window for clock granularity.
    const thirtyDays = 30 * 86_400;
    expect(payload?.exp).toBeGreaterThanOrEqual(before + thirtyDays - 5);
    expect(payload?.exp).toBeLessThanOrEqual(before + thirtyDays + 5);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signAccessToken('user-1', 'USER');
    process.env.JWT_SECRET = 'a-different-secret';
    expect(await verifyAccessToken(token)).toBeNull();
    process.env.JWT_SECRET = 'test-jwt-secret';
  });

  it('rejects garbage', async () => {
    expect(await verifyAccessToken('not.a.jwt')).toBeNull();
  });
});

describe('refresh token', () => {
  it('signs, verifies, and the jti hash matches', async () => {
    const issued = await signRefreshToken('user-2');
    const payload = await verifyRefreshToken(issued.token);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('user-2');
    expect(payload?.jti).toBe(issued.jti);
    expect(hashJti(issued.jti)).toBe(issued.tokenHash);
  });
});
