'use client';

import { useState, type ImgHTMLAttributes } from 'react';
import { refreshSession } from '@/lib/api/client';

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError' | 'alt'> & {
  src: string;
  /** Явно, а не через `...rest`: иначе `jsx-a11y/alt-text` не видит атрибут. */
  alt: string;
};

/**
 * Картинка из вальта, переживающая истечение сессии.
 *
 * Вложения грузятся браузером как `/api/projects/:id/files/:fileId`, то есть
 * тегом `<img>` в обход `lib/api/client`. Когда access-токен протухает (по
 * умолчанию через 15 минут), такой запрос получает 401 и картинка молча
 * ломается — на странице раскадровки это сразу десяток битых изображений.
 *
 * Здесь ошибка загрузки один раз пробует обновить сессию и перезапросить файл.
 * `refreshSession` дедуплицирован, поэтому десять одновременно упавших картинок
 * дадут **один** запрос к `/api/auth/refresh` (эндпоинт ротирует токены, и
 * параллельные обращения разлогинили бы пользователя).
 *
 * Повтор строго один: если и после обновления 401, это настоящий отказ, и
 * картинка остаётся сломанной — как повёл бы себя обычный `<img>`.
 */
export function AuthedImage({ src, alt, ...rest }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [retried, setRetried] = useState(false);

  return (
    <img
      {...rest}
      alt={alt}
      src={attempt === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}`}
      onError={() => {
        if (retried) return;
        setRetried(true);
        void refreshSession().then((ok) => {
          if (ok) setAttempt((n) => n + 1);
        });
      }}
    />
  );
}
