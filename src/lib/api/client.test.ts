/**
 * Обновление сессии при 401.
 *
 * До этой правки клиент не вызывал `/api/auth/refresh` вовсе: через
 * `JWT_ACCESS_TTL` (15 минут) любой запрос начинал отдавать 401, и в интерфейсе
 * вместо содержимого появлялось «Authentication required» — при живом
 * refresh-токене на 30 дней.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiGetText, refreshSession } from './client';

const ok = (body: string) => new Response(body, { status: 200 });
const unauthorized = () =>
  new Response(
    JSON.stringify({ error: { code: 'unauthorized', message: 'Authentication required' } }),
    {
      status: 401,
      headers: { 'content-type': 'application/json' },
    },
  );
const forbidden = () =>
  new Response(JSON.stringify({ error: { code: 'forbidden', message: 'Нет доступа' } }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const urlOf = (call: unknown[]) => call[0] as string;

describe('обновление сессии при 401', () => {
  it('обновляет сессию и повторяет запрос', async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized()) // исходный запрос
      .mockResolvedValueOnce(ok('')) // /api/auth/refresh
      .mockResolvedValueOnce(ok('содержимое заметки')); // повтор

    await expect(apiGetText('/api/projects/p1/files/f1')).resolves.toBe('содержимое заметки');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(urlOf(fetchMock.mock.calls[1]!)).toBe('/api/auth/refresh');
    expect(urlOf(fetchMock.mock.calls[2]!)).toBe('/api/projects/p1/files/f1');
  });

  it('повторяет ровно один раз — второй 401 отдаётся как ошибка', async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(ok('')) // обновление прошло
      .mockResolvedValueOnce(unauthorized()); // но доступа всё равно нет

    await expect(apiGetText('/api/projects/p1/files/f1')).rejects.toBeInstanceOf(ApiError);
    // Без ограничения повторов здесь был бы бесконечный цикл.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('не пытается обновиться, если обновление не удалось', async () => {
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(unauthorized()); // refresh отозван/истёк

    const err = await apiGetText('/api/projects/p1/files/f1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    // Исходный + попытка обновления. Повтора нет — обновиться не вышло.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('не трогает ошибки, не связанные с сессией', async () => {
    fetchMock.mockResolvedValueOnce(forbidden());

    const err = await apiGetText('/api/projects/p1/files/f1').catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(403);
    // 403 — это про права, обновлять сессию бессмысленно.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('параллельные 401 дают ОДНО обращение к /api/auth/refresh', async () => {
    // Ключевой случай: страница раскадровки, где разом протухает десяток
    // запросов. Эндпоинт ротирует пару токенов — второе параллельное обновление
    // пришло бы с уже отозванным refresh и разлогинило бы пользователя.
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/auth/refresh') return Promise.resolve(ok(''));
      const calls = fetchMock.mock.calls.filter((c) => urlOf(c) !== '/api/auth/refresh').length;
      return Promise.resolve(calls <= 5 ? unauthorized() : ok('данные'));
    });

    await Promise.all([
      apiGetText('/api/projects/p1/files/a'),
      apiGetText('/api/projects/p1/files/b'),
      apiGetText('/api/projects/p1/files/c'),
      apiGetText('/api/projects/p1/files/d'),
      apiGetText('/api/projects/p1/files/e'),
    ]);

    const refreshes = fetchMock.mock.calls.filter((c) => urlOf(c) === '/api/auth/refresh');
    expect(refreshes).toHaveLength(1);
  });

  it('после завершения обновления следующий 401 запускает новое', async () => {
    // Дедупликация не должна залипать: промис сбрасывается в finally.
    fetchMock.mockResolvedValueOnce(ok(''));
    await expect(refreshSession()).resolves.toBe(true);

    fetchMock.mockResolvedValueOnce(ok(''));
    await expect(refreshSession()).resolves.toBe(true);

    expect(fetchMock.mock.calls.filter((c) => urlOf(c) === '/api/auth/refresh')).toHaveLength(2);
  });

  it('сетевой сбой при обновлении не роняет запрос', async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockRejectedValueOnce(new Error('network down'));

    const err = await apiGetText('/api/projects/p1/files/f1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
  });
});
