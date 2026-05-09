# Obsidian Team — server

Серверная часть [Obsidian Team](../README.md) — самохостящегося решения для
синхронизации Obsidian-хранилищ между устройствами с поддержкой совместной
работы, истории изменений и live-режима.

Лицензия: **MIT**.

## Содержание

- [Что внутри](#что-внутри)
- [Быстрая установка на VPS](#быстрая-установка-на-vps)
- [Ручная установка](#ручная-установка)
- [Переменные окружения](#переменные-окружения)
- [Управление в продакшене](#управление-в-продакшене)
- [Разработка](#разработка)
- [Тесты](#тесты)
- [Документация](#документация)
- [Troubleshooting](#troubleshooting)

## Что внутри

- **Web** — Next.js 16 (App Router, RSC) на порту 3000: REST API, веб-админка
  для пользователей и SUPERADMIN, страницы регистрации/входа.
- **Socket** — отдельный Node.js-процесс на порту 3001: Socket.IO + Yjs CRDT
  для realtime-синхронизации и совместного редактирования.
- **PostgreSQL 16 + Prisma** — пользователи, проекты, файлы, операции, Yjs-state.
- **Caddy** — reverse-proxy с автоматическим Let's Encrypt; маршрутизирует
  `/socket.io/*` на порт 3001, всё остальное — на 3000.
- **PM2** — process manager под systemd для автостарта и graceful reload.
- **pino** + **pino-roll** — структурированные JSON-логи с ежедневной
  ротацией (`web.log`, `socket.log`, `audit.log`, `audit-socket.log`).

## Быстрая установка на VPS

Поддерживаются Ubuntu 22.04+ и Debian 12+.

```bash
git clone <repo-url> /tmp/obsidian-sync
sudo bash /tmp/obsidian-sync/scripts/install.sh
```

Скрипт **идемпотентен** — повторный запуск безопасно обновляет конфигурацию и
сохраняет уже сгенерированные секреты. Он:

1. ставит Node.js 20 LTS (NodeSource), pnpm, PostgreSQL 16 (PGDG), Caddy;
2. создаёт системного пользователя `obsidian` и директории
   `/opt/obsidian-sync` (код), `/var/log/obsidian-sync` (логи),
   `/var/lib/obsidian-sync` (хранилище файлов);
3. интерактивно спрашивает домен, email/пароль супер-админа, SMTP, флаг
   открытой регистрации;
4. генерирует `.env` с криптостойкими `JWT_SECRET` через `openssl rand`;
5. применяет миграции Prisma и запускает seed (создаёт супер-админа);
6. собирает приложение (`next build` + `tsup` для socket-процесса);
7. запускает обе службы под PM2 + systemd (`pm2 startup`);
8. подставляет домен в `Caddyfile` и перезагружает Caddy.

После установки откройте `https://<ваш-домен>` — Caddy автоматически выпустит
сертификат Let's Encrypt.

### Неинтерактивная установка

```bash
sudo NON_INTERACTIVE=1 \
  DOMAIN=sync.example.com \
  ADMIN_EMAIL=admin@example.com \
  ADMIN_PASSWORD='strong-password' \
  bash scripts/install.sh
```

### Обновление

```bash
sudo bash /opt/obsidian-sync/scripts/upgrade.sh
```

`upgrade.sh` делает `git pull --ff-only`, обновляет зависимости, применяет
миграции, пересобирает приложение и делает `pm2 reload --update-env`
(zero-downtime).

### Удаление

```bash
sudo bash /opt/obsidian-sync/scripts/uninstall.sh
# Полная очистка вместе с БД и хранилищем:
sudo bash /opt/obsidian-sync/scripts/uninstall.sh --drop-db --drop-storage --yes
```

## Ручная установка

Если установочный скрипт не подходит вашему окружению.

```bash
# 1. Системные пакеты
sudo apt-get install -y nodejs pnpm postgresql-16 caddy

# 2. БД
sudo -u postgres createuser -P obsidian        # CREATEDB
sudo -u postgres createdb -O obsidian obsidian_sync

# 3. Код + зависимости
git clone <repo-url> /opt/obsidian-sync
cd /opt/obsidian-sync
pnpm install --frozen-lockfile

# 4. Окружение — заполните по таблице ниже
cp .env.example .env

# 5. Миграции + seed
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm db:seed

# 6. Сборка
pnpm build           # запускает next build + tsup для socket-процесса

# 7. PM2
sudo npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd

# 8. Caddy
sudo cp config/Caddyfile.example /etc/caddy/Caddyfile
sudo sed -i 's/{$DOMAIN}/sync.example.com/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## Переменные окружения

Полный список — в [`.env.example`](./.env.example).

| Переменная           | Назначение                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | Строка подключения к PostgreSQL                                                           |
| `JWT_SECRET`         | Секрет для access-токенов (`openssl rand -base64 64`)                                     |
| `JWT_REFRESH_SECRET` | Отдельный секрет для refresh-токенов                                                      |
| `JWT_ACCESS_TTL`     | TTL access-токена (по умолчанию `15m`)                                                    |
| `JWT_REFRESH_TTL`    | TTL refresh-токена (по умолчанию `30d`)                                                   |
| `PORT_WEB`           | Порт Next.js (`3000`)                                                                     |
| `PORT_SOCKET`        | Порт Socket.IO (`3001`)                                                                   |
| `PUBLIC_URL`         | Внешний URL — используется в письмах и CORS                                               |
| `STORAGE_PATH`       | Путь к хранилищу файлов на диске                                                          |
| `OPEN_REGISTRATION`  | `true` — открытая регистрация; `false` — только по приглашениям                           |
| `SMTP_*`             | `HOST/PORT/USER/PASSWORD/FROM`. Без `SMTP_HOST` письма пишутся в `${LOG_DIR}/emails.log`. |
| `LOG_LEVEL`          | `debug` / `info` / `warn` / `error`                                                       |
| `LOG_DIR`            | Куда писать `web.log` / `socket.log` / `audit*.log`                                       |
| `ADMIN_EMAIL`        | Email супер-админа (создаётся при первом seed)                                            |
| `ADMIN_PASSWORD`     | Пароль супер-админа                                                                       |
| `MAX_FILE_SIZE`      | Лимит размера файла в байтах (пусто — без лимита)                                         |
| `OSYNC_PROCESS`      | Выставляется PM2-ом: `web` или `socket` — управляет именами лог-файлов                    |

## Управление в продакшене

```bash
# Состояние
sudo -u obsidian pm2 status

# PM2 stdout/stderr (start-up + crashes)
sudo -u obsidian pm2 logs obsidian-sync-web
sudo -u obsidian pm2 logs obsidian-sync-socket

# Структурированные JSON-логи (pino)
tail -f /var/log/obsidian-sync/web.log
tail -f /var/log/obsidian-sync/socket.log
tail -f /var/log/obsidian-sync/audit.log

# Перезагрузка без даунтайма (с применением новых ENV)
sudo -u obsidian pm2 reload ecosystem.config.cjs --update-env

# Caddy
sudo systemctl reload caddy
sudo journalctl -u caddy -f
```

## Разработка

```bash
git clone <repo-url> server
cd server

# 1. Зависимости
pnpm install

# 2. Локальный PostgreSQL (один раз)
createdb obsidian_sync_dev
createdb obsidian_sync_test

# 3. .env (для разработки достаточно скопировать пример)
cp .env.example .env

# 4. Миграции + seed
pnpm db:migrate
pnpm db:seed

# 5. Дев-сервер (web + socket в одном терминале)
pnpm dev
```

`pnpm dev` использует `concurrently` и поднимает оба процесса с цветными
префиксами `[web]` и `[socket]`.

### Скрипты

| Скрипт                               | Описание                                             |
| ------------------------------------ | ---------------------------------------------------- |
| `pnpm dev`                           | Web + socket с hot-reload                            |
| `pnpm dev:web` / `pnpm dev:socket`   | По отдельности                                       |
| `pnpm build`                         | `next build` + tsup-сборка socket-процесса           |
| `pnpm start` / `pnpm stop`           | PM2 ecosystem                                        |
| `pnpm lint` / `pnpm lint:fix`        | ESLint                                               |
| `pnpm typecheck`                     | `tsc --noEmit`                                       |
| `pnpm format` / `pnpm format:check`  | Prettier                                             |
| `pnpm test` / `pnpm test:watch`      | Vitest unit                                          |
| `pnpm test:integration`              | Vitest integration (требует БД `obsidian_sync_test`) |
| `pnpm test:all`                      | unit + integration                                   |
| `pnpm test:e2e` / `pnpm test:e2e:ui` | Playwright e2e                                       |
| `pnpm db:migrate`                    | Создать новую миграцию (dev)                         |
| `pnpm db:migrate:deploy`             | Применить миграции (prod)                            |
| `pnpm db:seed`                       | Запуск `prisma/seed.ts`                              |
| `pnpm db:studio`                     | Prisma Studio                                        |
| `pnpm db:reset`                      | Полный сброс схемы (только для dev!)                 |

## Тесты

- **Unit (Vitest)** — модули `lib/`, FS-helpers, Yjs-сходимость, Vector-clock.
  Не требуют сети/БД.
- **Integration (Vitest + реальный PostgreSQL)** — Prisma-схема, операции
  файлов, CRDT-persistence, Socket.IO end-to-end через `socket.io-client`.
  Требуется БД `obsidian_sync_test` (создайте её один раз через `createdb`).
- **E2E (Playwright)** — поднимает `pnpm dev` (изолированно через
  `webServer.env.DATABASE_URL=…obsidian_sync_test`) и тестирует flow через
  HTTP API и UI.

```bash
pnpm test:all                  # unit + integration
pnpm test:e2e                  # e2e через Playwright
```

## Документация

- [`docs/architecture.md`](./docs/architecture.md) — архитектура процессов,
  схема БД, поток данных.
- [`docs/api.md`](./docs/api.md) — REST API и Socket.IO события с примерами.
- [`docs/sync-protocol.md`](./docs/sync-protocol.md) — протокол синхронизации
  для разработчиков плагина.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — как отправлять PR.
- [`CHANGELOG.md`](./CHANGELOG.md) — история релизов.

## Troubleshooting

### Caddy не получает сертификат

Проверьте, что:

- DNS-запись `A` (или `AAAA`) указывает на ваш VPS;
- порты `80` и `443` открыты на firewall (`sudo ufw allow 80,443/tcp`);
- логи: `sudo journalctl -u caddy -n 200 | grep -i acme`.

Caddy кэширует сертификаты в `/var/lib/caddy/.local/share/caddy/certificates/`.

### PostgreSQL: connection refused

```bash
sudo systemctl status postgresql            # запущен ли
sudo -u postgres psql -c '\du'              # есть ли роль obsidian
cat /etc/postgresql/16/main/pg_hba.conf     # разрешён ли md5/scram
```

### SMTP не отправляет письма

Без `SMTP_HOST` сервер пишет письма в `${LOG_DIR}/emails.log` — это режим
разработки. Для продакшена выставьте полный набор `SMTP_*`.

### Сокет не подключается из плагина

1. Проверьте, что `wss://<домен>/socket.io/` отдаёт 101 Switching Protocols.
2. CORS: `PUBLIC_URL` в `.env` должен совпадать с реальным `https://<домен>`.
3. API-ключ: плагин должен передавать его в `socket.handshake.auth.apiKey`
   (формат `osync_<64hex>`).

### Логи

| Файл                                    | Что внутри                              |
| --------------------------------------- | --------------------------------------- |
| `${LOG_DIR}/web.log`                    | Next.js + REST API (JSON, pino)         |
| `${LOG_DIR}/socket.log`                 | Socket.IO события                       |
| `${LOG_DIR}/audit.log`                  | Аудит-события (SUPERADMIN actions, ...) |
| `${LOG_DIR}/audit-socket.log`           | Аудит из socket-процесса                |
| `${LOG_DIR}/pm2-web.{out,error}.log`    | stdout/stderr Next.js                   |
| `${LOG_DIR}/pm2-socket.{out,error}.log` | stdout/stderr socket-процесса           |
| `/var/log/caddy/access.log`             | Все HTTP-запросы (JSON)                 |

Все pino-файлы ротируются ежедневно или при 100 MB; хранится 14 последних.

## Лицензия

MIT — см. [LICENSE](./LICENSE).
