// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';
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

/**
 * Mint a remember-me access token that expires `secondsLeft` from now.
 *
 * Built by hand rather than via `signAccessToken` + `setTimeout`: the sliding
 * check compares `exp` against wall-clock time, so the old approach — a 2 s
 * window slept through for 1.1 s — failed outright whenever the machine
 * stalled long enough for the token to expire completely. Setting `exp`
 * directly gives days of slack instead of milliseconds.
 */
async function staleRememberToken(secondsLeft: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: 'USER', type: 'access', rememberMe: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('user-1')
    .setIssuedAt(now - 60)
    .setExpirationTime(now + secondsLeft)
    .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
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
    // 30 d window, token with 5 d left: 5*2 < 30, so the half-life trigger
    // fires. No sleeping, no race with the clock.
    const stale = await staleRememberToken(5 * 24 * 3600);

    const res = await proxy(withAccessCookie('/dashboard', stale));
    const fresh = readSetCookieToken(res);
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(stale);

    // Fresh token should re-verify and carry the same rememberMe flag.
    const payload = await verifyAccessToken(fresh!);
    expect(payload?.rememberMe).toBe(true);
    expect(payload?.sub).toBe('user-1');
  });

  it('leaves a remember-me token alone while more than half the window remains', async () => {
    // Mirror case, same mechanism: 20 d left of 30 d → 20*2 > 30, no re-issue.
    const res = await proxy(
      withAccessCookie('/dashboard', await staleRememberToken(20 * 24 * 3600)),
    );
    expect(readSetCookieToken(res)).toBeNull();
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

/**
 * Истёкший access при живом refresh больше не выбрасывает на форму входа.
 *
 * Раньше `proxy` в этом случае слал на `/login`, хотя сессия действительна ещё
 * 30 дней: человек отходил на двадцать минут, возвращался, кликал по ссылке — и
 * оказывался на входе. Теперь он идёт на маршрут обновления и возвращается
 * туда, куда шёл.
 */
describe('proxy — обновление сессии вместо формы входа', () => {
  const req = (url: string, cookie: string): NextRequest =>
    new NextRequest(`http://localhost${url}`, { headers: { cookie } });

  const location = (res: Response) =>
    new URL(res.headers.get('location') ?? '', 'http://localhost');

  it('без access, но с refresh — отправляет на обновление и хранит адрес', async () => {
    const res = await proxy(req('/projects/p1?tab=notes', 'osync_refresh=r1'));
    const loc = location(res);
    expect(loc.pathname).toBe('/api/auth/session-refresh');
    expect(loc.searchParams.get('next')).toBe('/projects/p1?tab=notes');
  });

  it('с непроходящим проверку access и живым refresh — тоже на обновление', async () => {
    // Намеренно без ожидания реального истечения: `proxy` идёт одной и той же
    // веткой `if (!payload)` и для протухшего, и для битого токена, а сон на
    // секунду ради этого делал тест плавающим.
    const broken = 'not.a.valid.jwt';
    expect(await verifyAccessToken(broken)).toBeNull();

    const res = await proxy(req('/dashboard', `osync_access=${broken}; osync_refresh=r1`));
    expect(location(res).pathname).toBe('/api/auth/session-refresh');
  });

  it('без refresh-cookie — по-прежнему на форму входа', async () => {
    const res = await proxy(req('/dashboard', ''));
    expect(location(res).pathname).toBe('/login');
  });

  it('повторный заход с меткой попытки — на форму входа, а не по кругу', async () => {
    // Метку ставит сам маршрут обновления. Без этой проверки протухший refresh
    // дал бы бесконечный круг proxy ⇄ обновление.
    const res = await proxy(req('/dashboard', 'osync_refresh=r1; osync_refresh_attempt=1'));
    expect(location(res).pathname).toBe('/login');
  });

  it('незащищённые пути не трогаются', async () => {
    const res = await proxy(req('/about', ''));
    expect(res.headers.get('location')).toBeNull();
  });
});
