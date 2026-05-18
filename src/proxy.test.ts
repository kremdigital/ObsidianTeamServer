// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { signAccessToken, verifyAccessToken } from '@/lib/auth/jwt';
import proxy from './proxy';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret';
  process.env.JWT_ACCESS_TTL = '15m';
  process.env.JWT_REFRESH_TTL = '30d';
  process.env.JWT_REMEMBER_TTL = '30d';
});

function withAccessCookie(url: string, token: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    headers: { cookie: `osync_access=${token}` },
  });
}

function readSetCookieToken(response: Response): string | null {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) return null;
  const m = /osync_access=([^;]+)/.exec(setCookie);
  return m && m[1] ? decodeURIComponent(m[1]) : null;
}

describe('proxy — sliding "Remember me" sessions', () => {
  it('does not refresh a fresh remember-me token (plenty of life left)', async () => {
    // Default 30 d TTL; a token signed right now has > 15 d remaining,
    // so the half-life trigger should NOT fire.
    const token = await signAccessToken('user-1', 'USER', { rememberMe: true });
    const res = await proxy(withAccessCookie('/dashboard', token));
    expect(readSetCookieToken(res)).toBeNull();
  });

  it('refreshes a remember-me token past the half-life mark', async () => {
    // Shrink the window to 2 s so we can race past its half-life in a
    // test that completes in milliseconds.
    process.env.JWT_REMEMBER_TTL = '2s';
    try {
      const stale = await signAccessToken('user-1', 'USER', { rememberMe: true });
      // Wait until > 50% of the 2 s window has elapsed.
      await new Promise((r) => setTimeout(r, 1100));

      const res = await proxy(withAccessCookie('/dashboard', stale));
      const fresh = readSetCookieToken(res);
      expect(fresh).not.toBeNull();
      expect(fresh).not.toBe(stale);

      // Fresh token should re-verify and carry the same rememberMe flag.
      const payload = await verifyAccessToken(fresh!);
      expect(payload?.rememberMe).toBe(true);
      expect(payload?.sub).toBe('user-1');
    } finally {
      process.env.JWT_REMEMBER_TTL = '30d';
    }
  });

  it('does not slide short (non-remember-me) sessions', async () => {
    process.env.JWT_ACCESS_TTL = '2s';
    try {
      const stale = await signAccessToken('user-1', 'USER');
      await new Promise((r) => setTimeout(r, 1100));
      const res = await proxy(withAccessCookie('/dashboard', stale));
      // Short session — proxy must not touch the cookie even when the
      // remaining life is small.
      expect(readSetCookieToken(res)).toBeNull();
    } finally {
      process.env.JWT_ACCESS_TTL = '15m';
    }
  });

  it('does not slide for Bearer-token (plugin) requests', async () => {
    // The Obsidian plugin uses an Authorization header, not the cookie.
    // Sliding the cookie there would be pointless and might overwrite
    // an unrelated session if the same browser had one.
    const token = await signAccessToken('user-1', 'USER', { rememberMe: true });
    const req = new NextRequest('http://localhost/dashboard', {
      headers: { authorization: `Bearer ${token}` },
    });
    const res = await proxy(req);
    expect(readSetCookieToken(res)).toBeNull();
  });
});
