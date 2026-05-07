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
  it('signs and verifies a valid access token', async () => {
    const token = await signAccessToken('user-1', 'USER');
    const payload = await verifyAccessToken(token);
    expect(payload).toEqual({ sub: 'user-1', role: 'USER', type: 'access' });
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
