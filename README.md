# Obsidian Sync — server

Серверная часть [Obsidian Sync](../README.md) — самохостящегося решения для синхронизации Obsidian-хранилищ.

> 🚧 В активной разработке. Полная документация будет на финальном этапе (см. `tasks.md` → Этап 14).

## Стек

- **Next.js 16** (App Router, RSC) + **React 19** + **TypeScript** + **Tailwind CSS v4**
- **PostgreSQL** + **Prisma** (планируется на Этапе 1)
- **Socket.IO** + **Yjs** (планируется на Этапах 7–9)
- **shadcn/ui** (`base-nova`) + **lucide-react**
- **Vitest** + **Playwright**
- **PM2** + **Caddy** + **pino** + **nodemailer** + **next-intl** (планируется)

## Требования к окружению

- Node.js ≥ 20 (рекомендуется LTS / 22)
- pnpm ≥ 9
- PostgreSQL ≥ 15 (для разработки и тестов)

## Быстрый старт (dev)

```bash
# 1. установить зависимости
pnpm install

# 2. создать .env из шаблона и заполнить значения
cp .env.example .env

# 3. запустить dev-сервер
pnpm dev
```

Откройте <http://localhost:3000>.

## Скрипты

| Скрипт                              | Что делает               |
| ----------------------------------- | ------------------------ |
| `pnpm dev`                          | Next dev-сервер          |
| `pnpm build`                        | Production-сборка        |
| `pnpm start`                        | Запуск production-сборки |
| `pnpm lint` / `pnpm lint:fix`       | ESLint                   |
| `pnpm typecheck`                    | `tsc --noEmit`           |
| `pnpm format` / `pnpm format:check` | Prettier                 |
| `pnpm test` / `pnpm test:watch`     | Vitest (unit)            |
| `pnpm test:coverage`                | Vitest с покрытием       |
| `pnpm test:e2e`                     | Playwright (e2e)         |

## Структура

```
src/
├── app/                  # App Router
│   ├── (public)/         # логин, регистрация, восстановление
│   ├── (app)/            # личный кабинет
│   ├── (admin)/          # админка
│   └── api/              # REST API
├── components/ui/        # shadcn-компоненты
├── lib/
│   ├── auth/   db/   files/   crdt/   sync/   email/   logger/   i18n/
├── socket/               # Socket.IO процесс
└── messages/             # next-intl переводы
prisma/                   # Prisma schema, миграции, seed
scripts/                  # установка / создание админа
config/                   # Caddyfile.example, прочее
tests/
├── unit/                 # Vitest
└── e2e/                  # Playwright
```

## Лицензия

MIT — см. [LICENSE](./LICENSE).
