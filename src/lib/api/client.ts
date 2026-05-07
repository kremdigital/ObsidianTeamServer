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

export async function apiPost<T>(
  url: string,
  body: unknown,
  init?: { signal?: AbortSignal },
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
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
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    ...(init?.signal ? { signal: init.signal } : {}),
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  return (await res.json()) as T;
}
