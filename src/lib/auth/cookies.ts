import { cookies } from 'next/headers';
import { REFRESH_COOKIE_NAME } from './session';
import { getAccessTtlSeconds, getRefreshTtlSeconds } from './jwt';

const ACCESS_COOKIE_NAME = 'osync_access';

const isProd = process.env.NODE_ENV === 'production';

export async function setRefreshCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: getRefreshTtlSeconds(),
  });
}

export async function clearRefreshCookie(): Promise<void> {
  const store = await cookies();
  store.delete(REFRESH_COOKIE_NAME);
}

export async function readRefreshCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(REFRESH_COOKIE_NAME)?.value ?? null;
}

/**
 * Set the access cookie. Pass `rememberMe = true` to align the cookie's
 * `maxAge` with the long JWT TTL — without that, the cookie would expire
 * 15 min after login even though the JWT inside is good for 30 days.
 */
export async function setAccessCookie(
  token: string,
  options: { rememberMe?: boolean } = {},
): Promise<void> {
  const store = await cookies();
  store.set(ACCESS_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: getAccessTtlSeconds(options.rememberMe === true),
  });
}

export async function clearAccessCookie(): Promise<void> {
  const store = await cookies();
  store.delete(ACCESS_COOKIE_NAME);
}
