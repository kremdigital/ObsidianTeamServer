import { cookies } from 'next/headers';
import { REFRESH_COOKIE_NAME } from './session';
import { getRefreshTtlSeconds } from './jwt';

const ACCESS_COOKIE_NAME = 'osync_access';
const ACCESS_TTL_SECONDS = 15 * 60;

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

export async function setAccessCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(ACCESS_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TTL_SECONDS,
  });
}

export async function clearAccessCookie(): Promise<void> {
  const store = await cookies();
  store.delete(ACCESS_COOKIE_NAME);
}
