import { NextResponse } from 'next/server';
import { refreshSessionCookies } from '@/lib/auth/refresh-session';

/** Метка одной попытки: живёт секунды и гасит цикл `proxy` ⇄ этот маршрут. */
export const REFRESH_ATTEMPT_COOKIE = 'osync_refresh_attempt';

/**
 * Разрешаем только относительный путь этого же сайта.
 *
 * `next` приходит из запроса, и без проверки это открытый редирект: `//evil.com`
 * и `https://evil.com` браузер трактует как внешний адрес, а `/\evil.com` —
 * как protocol-relative. Поэтому требуем ведущий `/` и запрещаем второй символ
 * `/` или `\`.
 */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/')) return '/dashboard';
  if (raw.length > 1 && (raw[1] === '/' || raw[1] === '\\')) return '/dashboard';
  return raw;
}

/**
 * Обновить сессию и вернуть пользователя туда, куда он шёл.
 *
 * Нужен потому, что `proxy` работает на edge-runtime и не может сам проверить
 * refresh-токен — для этого требуется БД. Раньше он при истёкшем access-токене
 * просто отправлял на `/login`, хотя refresh-токен жил ещё 30 дней: человек
 * отходил на 20 минут, возвращался, кликал по ссылке — и оказывался на форме
 * входа.
 *
 * Теперь `proxy` отправляет сюда, здесь пара токенов обновляется обычным путём,
 * и происходит возврат на исходный адрес. Если обновиться не удалось — честный
 * переход на вход с сохранением `next`.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get('next'));

  const result = await refreshSessionCookies(request);

  const target = new URL(result.ok ? next : '/login', url.origin);
  if (!result.ok && next !== '/dashboard') target.searchParams.set('next', next);

  const response = NextResponse.redirect(target);
  // Метку ставим в любом случае: при успехе она просто протухнет, при неудаче
  // не даст `proxy` отправить сюда снова по кругу.
  response.cookies.set(REFRESH_ATTEMPT_COOKIE, '1', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 10,
  });
  return response;
}
