// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { safeNext } from './route';

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
