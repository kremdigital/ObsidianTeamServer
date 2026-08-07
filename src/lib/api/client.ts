export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.error.message);
    this.name = 'ApiError';
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    body = { error: { code: 'unknown', message: res.statusText || 'Request failed' } };
  }
  return new ApiError(res.status, body);
}

const REFRESH_URL = '/api/auth/refresh';

/**
 * Единственный незавершённый запрос на обновление сессии.
 *
 * `/api/auth/refresh` **ротирует** пару токенов: отзывает текущий refresh и
 * выдаёт новый. Если на странице разом протухли десять запросов (типичная
 * раскадровка с картинками), десять параллельных обновлений сработают так:
 * первое отзовёт токен, остальные придут с уже отозванным — и сервер разлогинит
 * пользователя. Поэтому все ждут один и тот же промис.
 */
let inFlightRefresh: Promise<boolean> | null = null;

/**
 * Обновить сессию по refresh-cookie. Возвращает `true`, если сервер выдал новую
 * пару токенов, и `false`, если обновиться не удалось (refresh истёк, отозван
 * или отсутствует) — в этом случае вызывающий обязан пробросить исходную 401,
 * а не притворяться, что всё хорошо.
 *
 * Экспортируется, потому что нужна не только `fetch`-хелперам: изображения в
 * заметках грузятся тегом `<img>` в обход этого модуля и восстанавливаются
 * через собственный обработчик ошибки.
 */
export function refreshSession(): Promise<boolean> {
  inFlightRefresh ??= fetch(REFRESH_URL, { method: 'POST', credentials: 'include' })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      inFlightRefresh = null;
    });
  return inFlightRefresh;
}

/**
 * Запрос с прозрачным обновлением сессии.
 *
 * `JWT_ACCESS_TTL` — 15 минут, и до этой правки истечение access-токена
 * означало, что всё содержимое страницы разом начинало отдавать
 * «Authentication required»: обновления сессии в клиенте не было вовсе, хотя
 * refresh-токен жил 30 дней. Теперь 401 один раз пытается обновиться и
 * повторяет запрос.
 *
 * Повтор строго однократный: если после обновления снова 401, это настоящий
 * отказ (нет прав, чужой проект), и его надо показать пользователю.
 */
async function request(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, { credentials: 'include', ...init });
  if (res.status !== 401 || url === REFRESH_URL) return res;
  if (!(await refreshSession())) return res;
  return fetch(url, { credentials: 'include', ...init });
}

export async function apiPost<T>(
  url: string,
  body: unknown,
  init?: { signal?: AbortSignal },
): Promise<T> {
  const res = await request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(init?.signal ? { signal: init.signal } : {}),
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  return (await res.json()) as T;
}

export async function apiGet<T>(url: string, init?: { signal?: AbortSignal }): Promise<T> {
  const res = await request(url, {
    method: 'GET',
    ...(init?.signal ? { signal: init.signal } : {}),
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  return (await res.json()) as T;
}

export async function apiGetText(url: string, init?: { signal?: AbortSignal }): Promise<string> {
  const res = await request(url, {
    method: 'GET',
    ...(init?.signal ? { signal: init.signal } : {}),
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  return await res.text();
}

export async function apiPatch<T>(
  url: string,
  body: unknown,
  init?: { signal?: AbortSignal },
): Promise<T> {
  const res = await request(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(init?.signal ? { signal: init.signal } : {}),
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  return (await res.json()) as T;
}
