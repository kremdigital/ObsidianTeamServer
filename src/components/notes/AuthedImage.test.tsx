/**
 * Вложения грузятся тегом `<img>` мимо `lib/api/client`, поэтому истечение
 * сессии ломало их молча: на странице раскадровки — сразу десяток битых
 * картинок с «Authentication required» вместо содержимого.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthedImage } from './AuthedImage';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const SRC = '/api/projects/p1/files/f1';

describe('AuthedImage', () => {
  it('после ошибки обновляет сессию и перезапрашивает файл', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }));
    render(<AuthedImage src={SRC} alt="раскадровка" />);

    const img = screen.getByAltText('раскадровка');
    expect(img.getAttribute('src')).toBe(SRC);

    fireEvent.error(img);

    await waitFor(() => {
      expect(screen.getByAltText('раскадровка').getAttribute('src')).toBe(`${SRC}?retry=1`);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/refresh',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('не повторяет, если обновление не удалось', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }));
    render(<AuthedImage src={SRC} alt="раскадровка" />);

    fireEvent.error(screen.getByAltText('раскадровка'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Ссылка не меняется: сессию восстановить не вышло, картинка остаётся
    // сломанной — как повёл бы себя обычный <img>.
    expect(screen.getByAltText('раскадровка').getAttribute('src')).toBe(SRC);
  });

  it('повторяет ровно один раз', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }));
    render(<AuthedImage src={SRC} alt="раскадровка" />);

    fireEvent.error(screen.getByAltText('раскадровка'));
    await waitFor(() =>
      expect(screen.getByAltText('раскадровка').getAttribute('src')).toBe(`${SRC}?retry=1`),
    );

    // Повторная ошибка не должна запускать бесконечный цикл обновлений.
    fireEvent.error(screen.getByAltText('раскадровка'));
    await new Promise((r) => setTimeout(r, 20));

    const refreshes = fetchMock.mock.calls.filter((c) => c[0] === '/api/auth/refresh');
    expect(refreshes).toHaveLength(1);
  });

  it('сохраняет переданные атрибуты', () => {
    render(<AuthedImage src={SRC} alt="подпись" loading="lazy" className="рамка" />);
    const img = screen.getByAltText('подпись');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.className).toBe('рамка');
  });
});
