// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { redirectLocation, safeNext } from './route';

/**
 * `next` приходит из запроса, поэтому без проверки это открытый редирект:
 * пользователя можно увести на чужой сайт по ссылке вида
 * `/api/auth/session-refresh?next=//evil.example`.
 */
describe('safeNext', () => {
  it('пропускает относительный путь этого сайта', () => {
    expect(safeNext('/projects/p1?tab=notes')).toBe('/projects/p1?tab=notes');
    expect(safeNext('/dashboard')).toBe('/dashboard');
  });

  it('отбивает абсолютный адрес', () => {
    expect(safeNext('https://evil.example/steal')).toBe('/dashboard');
    expect(safeNext('http://evil.example')).toBe('/dashboard');
  });

  it('отбивает protocol-relative адрес', () => {
    // `//evil.example` браузер считает внешним адресом, а не путём.
    expect(safeNext('//evil.example')).toBe('/dashboard');
    expect(safeNext('/\\evil.example')).toBe('/dashboard');
  });

  it('подставляет запасной путь на пустом значении', () => {
    expect(safeNext(null)).toBe('/dashboard');
    expect(safeNext('')).toBe('/dashboard');
    expect(safeNext('projects/p1')).toBe('/dashboard');
  });

  it('одиночный слэш остаётся допустимым', () => {
    expect(safeNext('/')).toBe('/');
  });
});

/**
 * Адрес возврата обязан быть относительным.
 *
 * За Caddy `request.url` содержит внутренний адрес (`localhost:3000`), и
 * абсолютный редирект, построенный от него, уводил пользователя на
 * несуществующий хост — поймано проверкой на проде уже после выката.
 */
describe('redirectLocation', () => {
  it('при успехе ведёт туда, куда шёл пользователь', () => {
    expect(redirectLocation('/projects/p1?tab=notes', true)).toBe('/projects/p1?tab=notes');
  });

  it('при неудаче ведёт на вход и сохраняет адрес', () => {
    expect(redirectLocation('/projects/p1', false)).toBe('/login?next=%2Fprojects%2Fp1');
  });

  it('запасной путь не тащит лишний параметр', () => {
    expect(redirectLocation('/dashboard', false)).toBe('/login');
  });

  it('всегда относительный — никакого хоста и схемы', () => {
    for (const loc of [
      redirectLocation('/projects/p1', true),
      redirectLocation('/projects/p1', false),
      redirectLocation('/dashboard', false),
    ]) {
      expect(loc.startsWith('/')).toBe(true);
      expect(loc).not.toContain('://');
      expect(loc).not.toContain('localhost');
    }
  });
});
