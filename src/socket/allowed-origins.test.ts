// @vitest-environment node
/**
 * Домены-зеркала и socket-хендшейк.
 *
 * Рукопожатие идёт с `credentials: true`, поэтому браузер требует точного
 * совпадения origin. Если зеркало не перечислено, на нём отдаются страницы, но
 * веб-редактор молча не подключается — половина сайта работает, половина нет.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allowedOrigins } from './server';

const saved = { pub: process.env.PUBLIC_URL, extra: process.env.EXTRA_ORIGINS };

beforeEach(() => {
  delete process.env.PUBLIC_URL;
  delete process.env.EXTRA_ORIGINS;
});

afterEach(() => {
  if (saved.pub === undefined) delete process.env.PUBLIC_URL;
  else process.env.PUBLIC_URL = saved.pub;
  if (saved.extra === undefined) delete process.env.EXTRA_ORIGINS;
  else process.env.EXTRA_ORIGINS = saved.extra;
});

describe('allowedOrigins', () => {
  it('без зеркал отдаёт один PUBLIC_URL строкой', () => {
    process.env.PUBLIC_URL = 'https://obsidian.artillect.pro';
    expect(allowedOrigins()).toBe('https://obsidian.artillect.pro');
  });

  it('добавляет зеркала к основному домену', () => {
    process.env.PUBLIC_URL = 'https://obsidian.artillect.pro';
    process.env.EXTRA_ORIGINS = 'https://teamvault.artillect.pro';
    expect(allowedOrigins()).toEqual([
      'https://obsidian.artillect.pro',
      'https://teamvault.artillect.pro',
    ]);
  });

  it('понимает список через запятую и терпит пробелы', () => {
    process.env.PUBLIC_URL = 'https://a.example';
    process.env.EXTRA_ORIGINS = ' https://b.example , https://c.example ';
    expect(allowedOrigins()).toEqual([
      'https://a.example',
      'https://b.example',
      'https://c.example',
    ]);
  });

  it('пустое значение не добавляет пустых origin', () => {
    process.env.PUBLIC_URL = 'https://a.example';
    process.env.EXTRA_ORIGINS = '  ,  ';
    // Пустая строка в списке origin'ов означала бы «разрешить origin ""» —
    // мусор, который лучше не отдавать в socket.io.
    expect(allowedOrigins()).toBe('https://a.example');
  });

  it('без PUBLIC_URL остаётся локальный адрес разработки', () => {
    expect(allowedOrigins()).toBe('http://localhost:3000');
  });
});
