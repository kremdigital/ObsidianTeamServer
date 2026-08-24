import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts');

const nextConfig: NextConfig = {
  // Версия фреймворка наружу не нужна: она только подсказывает, какие
  // публичные уязвимости пробовать.
  poweredByHeader: false,

  /**
   * Yjs и его протокольные пакеты берутся из `node_modules`, а не бандлятся.
   *
   * Иначе в web-процессе оказывались ДВА экземпляра `yjs`: один в SSR-чанке
   * (клиентский `NoteEditor` рендерится и на сервере), другой в серверном
   * (`lib/sync/rest-write.ts`, `lib/crdt/*`). Yjs проверяет типы через
   * `instanceof`, и при двух копиях эти проверки врут — сам Yjs кричит об этом
   * в лог: «Yjs was already imported. This breaks constructor checks».
   *
   * Падения это не вызывало, что и опасно: на проекте с двумя инцидентами
   * задвоения контента тихо неверное слияние — худший из возможных сценариев.
   */
  serverExternalPackages: ['yjs', 'y-protocols'],
};

export default withNextIntl(nextConfig);
