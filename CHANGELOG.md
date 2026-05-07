# Changelog

Все значимые изменения серверной части документируются здесь.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
проект следует [Semantic Versioning](https://semver.org/lang/ru/).

## [Unreleased]

### Added

- **Аутентификация и сессии.** JWT (HS256) + refresh-rotation через `sha256(jti)`,
  httpOnly cookies + опциональный `Authorization: Bearer`, dual-auth
  (cookie ИЛИ X-API-Key) для всех `/api/projects/*/files/*` эндпоинтов.
- **Управление пользователями.** Регистрация (open / invite-only),
  верификация email, восстановление пароля, профиль.
- **API-ключи.** Формат `osync_<64hex>`. Bcrypt-хеш + 12-символьный prefix
  для быстрого поиска. UI с copy-to-clipboard «показывается один раз».
- **Проекты и участники.** CRUD проектов, роли ADMIN/EDITOR/VIEWER,
  приглашения по email + share-link, idempotent accept-invite,
  permission-хелперы.
- **Файлы и версионирование.** Атомарная FS-запись (`temp+rename`),
  multipart upload, дуальная авторизация (session или X-API-Key),
  soft-delete, переименование/перемещение, snapshot версий в
  `.versions/<fileId>/<n>.snapshot` с дедупликацией по хешу.
- **CRDT-слой (Yjs).** Persistence в PostgreSQL (`YjsDocument` с
  `state` + `stateVector`), debounced snapshot текста в `.md` файл,
  garbage collection через `Y.encodeStateAsUpdate`.
- **Журнал операций (vector clock).** `OperationLog` с типизированными
  payload'ами для CREATE/UPDATE/DELETE/RENAME/MOVE; детерминированная
  резолюция конфликтов (CREATE-collision, DELETE>UPDATE, concurrent RENAME).
- **Socket.IO.** Отдельный процесс, аутентификация через
  `socket.handshake.auth.apiKey`, rooms по `project_id`, `project:join`
  с catch-up из OperationLog и Yjs sync, `file:*` события + `yjs:update`,
  graceful SIGTERM/SIGINT.
- **Админка SUPERADMIN.** Управление пользователями (роль, блокировка,
  верификация email, удаление), проектами, server-приглашениями,
  настройками сервера, audit-лог с фильтрами.
- **Логирование (pino).** JSON-логи в production с ежедневной ротацией
  через pino-roll (100MB / 14 файлов). Отдельные файлы для web/socket
  процессов и audit-событий. `withApiLogger` wrapper для request-логов.
- **Деплой.** `scripts/install.sh` (идемпотентный installer для
  Ubuntu/Debian), `scripts/upgrade.sh` (zero-downtime через `pm2 reload`),
  `scripts/uninstall.sh` (с защитой данных по умолчанию).
- **Артефакты.** PM2 ecosystem (`ecosystem.config.cjs`), Caddyfile-шаблон с
  `{$DOMAIN}` и rate-limit на auth-эндпоинтах, tsup-сборка socket-процесса
  в `dist/socket/server.mjs`.
- **next-intl.** Все строки UI вынесены в `src/messages/ru.json`.
  Архитектура готова к мультиязычности.
- **Тесты.** 48 unit (Vitest) + 58 integration (Vitest + реальный
  PostgreSQL) + 19 e2e (Playwright) — полное покрытие auth, projects,
  files, CRDT, sync, socket, admin.
- **Документация.** README сервера, `docs/architecture.md`,
  `docs/api.md`, `docs/sync-protocol.md`, `CONTRIBUTING.md`.

### Tech stack

- Next.js 16, React 19, TypeScript 5.9, Tailwind CSS v4
- Prisma 7 (driver-adapter `@prisma/adapter-pg`), PostgreSQL 16
- Socket.IO 4.8, Yjs 13.6, y-protocols 1.0
- pino 10 + pino-pretty + pino-roll
- shadcn/ui (`radix-nova` стиль) + lucide-react + sonner
- Vitest 4, Playwright 1.59
- pnpm 10

[Unreleased]: https://github.com/<owner>/obsidian-sync/compare/HEAD
