# Tasks: серверная часть Obsidian Sync

Подробный план разработки серверной части. Задачи выполняются последовательно сверху вниз, объединены в этапы. Каждый этап завершается работающим, проверяемым результатом.

**Стек:** Next.js 16 (App Router) + TypeScript + Tailwind CSS v4 + PostgreSQL + Prisma + Socket.IO + Yjs + PM2 + Caddy + pino + nodemailer + next-intl.

**Архитектура процессов:** два отдельных Node.js-процесса в одном репозитории — `web` (Next.js, порт 3000) и `socket` (Socket.IO + Yjs, порт 3001), оба под PM2, маршрутизируются через Caddy.

---

## Этап 0. Инициализация проекта

- [ ] **0.1.** Создать Next.js 16 проект:
  ```bash
  pnpm create next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --turbopack
  ```
- [ ] **0.2.** Настроить `tsconfig.json` со `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- [ ] **0.3.** Установить и настроить **Prettier** + плагин для Tailwind (`prettier-plugin-tailwindcss`). Создать `.prettierrc` и `.prettierignore`.
- [ ] **0.4.** Установить **husky** + **lint-staged**, настроить pre-commit hook на `eslint --fix` и `prettier --write`.
- [ ] **0.5.** Настроить **commitlint** (Conventional Commits) и commit-msg hook.
- [ ] **0.6.** Создать структуру папок:
  ```
  src/
  ├── app/                  # App Router
  │   ├── (public)/         # логин, регистрация, восстановление пароля
  │   ├── (app)/            # личный кабинет пользователя
  │   ├── (admin)/          # админка суперадмина
  │   ├── api/              # REST API endpoints
  │   └── layout.tsx
  ├── components/           # React-компоненты
  │   └── ui/               # shadcn/ui-компоненты
  ├── lib/                  # бизнес-логика, общие модули
  │   ├── auth/             # аутентификация
  │   ├── db/               # Prisma client, helpers
  │   ├── files/            # работа с ФС хранилища
  │   ├── crdt/             # Yjs, persistence, snapshots
  │   ├── sync/             # журнал операций, vector clock
  │   ├── email/            # nodemailer
  │   ├── logger/           # pino
  │   └── i18n/             # next-intl
  ├── socket/               # отдельный Socket.IO процесс
  │   ├── server.ts         # entrypoint
  │   ├── handlers/         # обработчики событий
  │   └── auth.ts
  ├── messages/             # переводы (next-intl)
  │   └── ru.json
  └── middleware.ts         # Next.js middleware (auth, i18n)
  prisma/
  ├── schema.prisma
  └── seed.ts
  scripts/
  ├── install.sh
  └── create-admin.ts
  config/
  └── Caddyfile.example
  ecosystem.config.js       # PM2
  ```
- [ ] **0.7.** Создать `.env.example` со всеми требуемыми переменными:

  ```
  # БД
  DATABASE_URL=postgresql://obsidian:obsidian@localhost:5432/obsidian_sync_dev

  # Auth
  JWT_SECRET=
  JWT_REFRESH_SECRET=
  JWT_ACCESS_TTL=15m
  JWT_REFRESH_TTL=30d

  # Сервер
  PORT_WEB=3000
  PORT_SOCKET=3001
  PUBLIC_URL=http://localhost:3000
  STORAGE_PATH=/var/lib/obsidian-sync

  # Регистрация
  OPEN_REGISTRATION=false

  # SMTP
  SMTP_HOST=
  SMTP_PORT=587
  SMTP_USER=
  SMTP_PASSWORD=
  SMTP_FROM=

  # Логи
  LOG_LEVEL=info
  LOG_DIR=/var/log/obsidian-sync

  # Bootstrap
  ADMIN_EMAIL=
  ADMIN_PASSWORD=
  ```

- [ ] **0.8.** Установить и инициализировать **shadcn/ui** в классическом стиле (`base radix`, preset `nova`): `npx shadcn@latest init --yes --base radix --preset nova`. Настроить тему. Добавить базовые компоненты (`button`, `input`, `dialog`, `table`, `dropdown-menu`, `sonner` (вместо `toast`), `label`, `card`). _Замечание:_ shadcn ≥ 4.x больше не поставляет компонент `form` (обёртку над `react-hook-form`) ни в одном из стилей — формы строятся напрямую на `react-hook-form` (см. 3.7).
- [ ] **0.9.** Подключить **lucide-react** для иконок.
- [ ] **0.10.** Установить и настроить **Vitest** для unit-тестов и **Playwright** для e2e. Написать пример теста для проверки настройки.
- [ ] **0.11.** Создать `LICENSE` (MIT) и `README.md` с заглушкой (детально заполнить на финальном этапе).

---

## Этап 1. База данных и Prisma-схема

- [ ] **1.1.** Установить Prisma: `pnpm add -D prisma`, `pnpm add @prisma/client`. Инициализировать: `pnpm prisma init`.
- [ ] **1.2.** Описать модели в `prisma/schema.prisma`:
  - **User** — id, email (unique), passwordHash, name, role (`USER` | `SUPERADMIN`), emailVerified (timestamp), language, createdAt, updatedAt.
  - **EmailVerificationToken** — id, userId, token (unique), expiresAt.
  - **PasswordResetToken** — id, userId, token (unique), expiresAt, usedAt.
  - **RefreshToken** — id, userId, tokenHash, userAgent, ip, expiresAt, revokedAt.
  - **ApiKey** — id, userId, name, keyHash, keyPrefix (для отображения), lastUsedAt, expiresAt (nullable), createdAt.
  - **Project** — id, slug (unique), name, description, iconEmoji, ownerId, createdAt, updatedAt.
  - **ProjectMember** — id, projectId, userId, role (`ADMIN` | `EDITOR` | `VIEWER`), addedAt, addedById. Уникальный индекс по (projectId, userId).
  - **ProjectInvitation** — id, projectId, email (nullable, для именных), role, token (unique), invitedById, expiresAt, acceptedAt, acceptedById. Поддерживает оба типа: по email и по share-ссылке.
  - **ServerInvitation** — id, email, token, invitedById, expiresAt, acceptedAt. (Для invite-only режима регистрации.)
  - **VaultFile** — id, projectId, path (относительный путь в хранилище), fileType (`TEXT` | `BINARY`), contentHash (SHA-256), size, mimeType, deletedAt (soft delete для tombstone), createdAt, updatedAt, lastModifiedById. Уникальный индекс по (projectId, path).
  - **YjsDocument** — id, fileId (1:1 с VaultFile), state (Bytes — Yjs binary state), stateVector (Bytes), updatedAt.
  - **FileVersion** — id, fileId, versionNumber, contentHash, snapshotPath (относительный путь к снапшоту в storage), authorId, message (nullable), createdAt. Уникальный (fileId, versionNumber).
  - **OperationLog** — id, projectId, opType (`CREATE` | `UPDATE` | `DELETE` | `RENAME` | `MOVE`), filePath, newPath (для RENAME/MOVE), authorId, vectorClock (Json), payload (Json — детали операции), createdAt. Индекс по (projectId, createdAt).
  - **AuditLog** — id, userId (nullable, для системных), action, entityType, entityId, metadata (Json), ip, userAgent, createdAt.
  - **ServerConfig** — key (PK, String), value (Json), updatedAt. Хранит динамические настройки сервера: `openRegistration`, `smtpEnabled`, и т.п.

- [ ] **1.3.** Прописать все нужные индексы и cascading deletes (например, удаление Project каскадно удаляет ProjectMember, VaultFile и т.д.).
- [ ] **1.4.** Создать первую миграцию: `pnpm prisma migrate dev --name init`.
- [ ] **1.5.** Написать `prisma/seed.ts`:
  - создаёт супер-админа из `ADMIN_EMAIL` / `ADMIN_PASSWORD`,
  - создаёт начальные `ServerConfig` записи (на основе `OPEN_REGISTRATION` env).
- [ ] **1.6.** Настроить `package.json` script `db:seed` и Prisma seed-хук.
- [ ] **1.7.** Создать `src/lib/db/client.ts` — singleton Prisma клиента с защитой от множественной инстанциации в dev (Hot Module Reload).
- [ ] **1.8.** Написать unit-тесты для проверки целостности схемы (создание основных сущностей, каскадные удаления, уникальные индексы).

---

## Этап 2. Аутентификация и сессии

- [ ] **2.1.** Установить зависимости: `bcryptjs`, `jose` (для JWT), `zod` (валидация), `react-hook-form`, `@hookform/resolvers`.
- [ ] **2.2.** Реализовать `src/lib/auth/password.ts`: хеширование (bcrypt с salt rounds = 12), проверка.
- [ ] **2.3.** Реализовать `src/lib/auth/jwt.ts`:
  - выпуск access-токена (15 мин TTL),
  - выпуск refresh-токена (30 дней TTL, хранится в `RefreshToken` с хешем),
  - верификация токенов,
  - ротация refresh-токенов при использовании.
- [ ] **2.4.** Реализовать `src/lib/auth/session.ts`:
  - чтение access-токена из заголовка `Authorization: Bearer` или из httpOnly cookie,
  - получение текущего пользователя,
  - проверка email-верификации (если требуется по конфигу).
- [ ] **2.5.** Реализовать API-роуты в `src/app/api/auth/`:
  - `POST /api/auth/register` — регистрация (если открыта или есть валидный invite-токен).
  - `POST /api/auth/login` — выпуск access + refresh, refresh кладётся в httpOnly secure cookie.
  - `POST /api/auth/refresh` — обмен refresh на новую пару (с ротацией).
  - `POST /api/auth/logout` — отзыв refresh-токена, очистка cookie.
  - `POST /api/auth/verify-email` — подтверждение email по токену.
  - `POST /api/auth/forgot-password` — отправка письма с reset-токеном.
  - `POST /api/auth/reset-password` — установка нового пароля.
- [ ] **2.6.** Все handler'ы валидируются через Zod-схемы. Ошибки возвращаются в едином формате `{ error: { code, message, fields? } }`.
- [ ] **2.7.** Реализовать `src/middleware.ts`:
  - проверка access-токена для защищённых роутов,
  - редирект неавторизованных на `/login`,
  - проверка роли `SUPERADMIN` для админских роутов.
- [ ] **2.8.** Реализовать `src/lib/email/`:
  - nodemailer transport на основе env,
  - шаблоны: верификация email, восстановление пароля, приглашение в проект, приглашение на сервер.
  - В режиме dev (без SMTP) — логировать письма в файл / консоль.
- [ ] **2.9.** Написать тесты для всех auth-эндпоинтов (Vitest + Supertest, изолированная PostgreSQL через Testcontainers).
- [ ] **2.10.** Написать e2e-тест Playwright для полного цикла: регистрация → верификация email (программно) → логин → logout.

---

## Этап 3. Личный кабинет и базовый UI

- [ ] **3.1.** Создать layout публичных страниц `app/(public)/layout.tsx` и приложения `app/(app)/layout.tsx` (с навигацией, выходом).
- [ ] **3.2.** Подключить **next-intl**: создать `src/messages/ru.json`, настроить middleware и Layout для локализации. Все строки UI берутся из переводов (даже если язык один — это закладка под будущее).
- [ ] **3.3.** Реализовать страницы `app/(public)/`:
  - `/login` — форма входа.
  - `/register` — форма регистрации (показывается, только если `OPEN_REGISTRATION=true` или есть `?invite=token`).
  - `/forgot-password` и `/reset-password/[token]`.
  - `/verify-email/[token]`.
  - `/invite/[token]` — принятие приглашения (на сервер или в проект — определяется по типу токена).
- [ ] **3.4.** Реализовать страницы `app/(app)/`:
  - `/dashboard` — список проектов пользователя (свои + где он участник).
  - `/profile` — профиль, смена имени, языка, пароля.
  - `/api-keys` — управление API-ключами (см. Этап 4).
  - `/notifications` — приглашения в проекты.
- [ ] **3.5.** Реализовать переиспользуемые UI-компоненты: AppHeader, Sidebar, EmptyState, ConfirmDialog, FormError, Toast-обёртка.
- [ ] **3.6.** Toast-уведомления через компонент `sonner` (поставлен на Этапе 0.8 как замена устаревшему `toast`).
- [ ] **3.7.** Все формы — на `react-hook-form` + zod resolver, без shadcn-обёртки `Form/FormField` (в shadcn ≥ 4.x её нет). Если потребуется единая стилистика ошибок и подписей — реализовать тонкие локальные wrapper-компоненты (`<FormField>`, `<FormError>`) в `src/components/forms/` поверх `react-hook-form`'овских `<Controller>` / `useFormContext`.

---

## Этап 4. API-ключи

- [ ] **4.1.** Реализовать `src/lib/auth/api-key.ts`:
  - генерация ключа формата `osync_<random32hex>`,
  - хеширование ключа (bcrypt) для хранения,
  - извлечение префикса (первые 12 символов) для отображения.
- [ ] **4.2.** API-роуты в `src/app/api/api-keys/`:
  - `GET` — список ключей пользователя (без полных значений, только префикс и метаданные).
  - `POST` — создание (полный ключ возвращается **один раз**).
  - `DELETE /[id]` — отзыв ключа.
- [ ] **4.3.** Реализовать middleware `src/lib/auth/api-key-middleware.ts` для аутентификации запросов к sync-API по заголовку `X-API-Key`. Обновляет `lastUsedAt`.
- [ ] **4.4.** UI на странице `/api-keys`:
  - таблица ключей с префиксом, именем, датами создания и последнего использования,
  - кнопка создания с модалкой,
  - после создания — модалка с полным ключом и copy-to-clipboard кнопкой и предупреждением «больше не покажется»,
  - кнопка отзыва с confirm.
- [ ] **4.5.** Тесты: создание, отзыв, аутентификация по ключу, обновление `lastUsedAt`.

---

## Этап 5. Управление проектами и участниками

- [ ] **5.1.** API-роуты в `src/app/api/projects/`:
  - `GET /api/projects` — список проектов пользователя.
  - `POST /api/projects` — создание (создатель = ADMIN автоматически).
  - `GET /api/projects/[id]` — данные проекта (если пользователь — участник).
  - `PATCH /api/projects/[id]` — обновление метаданных (только ADMIN).
  - `DELETE /api/projects/[id]` — удаление (только владелец или SUPERADMIN), с soft delete или каскадно.
  - `GET /api/projects/[id]/members` — список участников.
  - `POST /api/projects/[id]/members` — добавление существующего пользователя (только ADMIN). Альтернатива — приглашение по email.
  - `PATCH /api/projects/[id]/members/[memberId]` — смена роли (только ADMIN).
  - `DELETE /api/projects/[id]/members/[memberId]` — удаление участника.
- [ ] **5.2.** Приглашения в проект — `src/app/api/projects/[id]/invitations/`:
  - `POST` — создать приглашение. Поддерживает два режима: `{ email, role }` (отправит письмо) или `{ role, shareLink: true }` (вернёт URL вида `/invite/<token>` для копирования).
  - `GET` — список активных приглашений (только ADMIN).
  - `DELETE /[token]` — отозвать приглашение.
- [ ] **5.3.** Принятие приглашения — `POST /api/auth/accept-invite`:
  - если пользователь не залогинен и не зарегистрирован — редирект на регистрацию с сохранением токена,
  - если залогинен — проверка совпадения email (если в инвайте email указан),
  - создание `ProjectMember`, инвалидация инвайта.
- [ ] **5.4.** Permissions-хелперы в `src/lib/auth/permissions.ts`:
  - `canViewProject(user, project)`,
  - `canEditFiles(user, project)` — ADMIN или EDITOR,
  - `canManageMembers(user, project)` — только ADMIN,
  - `canDeleteProject(user, project)` — owner или SUPERADMIN.
  - Все API-роуты используют эти хелперы.
- [ ] **5.5.** UI:
  - `/projects/[id]` — обзор проекта: метаданные, список файлов (после Этапа 7), кнопка управления участниками.
  - `/projects/[id]/settings` — редактирование метаданных, управление участниками, приглашения.
  - Создание проекта через модалку с `Dialog`.
  - Drag-and-drop для удобства не нужен в MVP.
- [ ] **5.6.** Тесты на permissions: попытки действий с разных ролей должны корректно отклоняться (403).

---

## Этап 6. Хранение файлов на сервере

- [ ] **6.1.** Реализовать `src/lib/files/storage.ts` — слой работы с файловой системой:
  - корень: `STORAGE_PATH` env (по умолчанию `/var/lib/obsidian-sync` в проде, `./storage` в dev).
  - структура: `<STORAGE_PATH>/<projectId>/<file_path>` (с сохранением исходной структуры папок vault'а).
  - функции: `readFile`, `writeFile`, `deleteFile`, `moveFile`, `listFiles`, `getFileStats`.
  - все операции — атомарные (запись через temp + rename).
  - валидация путей: запрет `..`, абсолютных путей, символьных ссылок.
- [ ] **6.2.** Реализовать `src/lib/files/hash.ts` — стриминговое вычисление SHA-256 без полной загрузки в память.
- [ ] **6.3.** Реализовать `src/lib/files/versioning.ts` — управление версиями:
  - снапшот при каждом значимом изменении (debounced — обсуждается в этапе CRDT),
  - формат хранения снапшотов: `<STORAGE_PATH>/<projectId>/.versions/<fileId>/<versionNumber>.snapshot`,
  - чтение версии, список версий, diff между версиями (через `diff` библиотеку для текстов).
- [ ] **6.4.** REST-эндпоинты для работы с файлами (для бинарных и для случаев, когда плагин не использует CRDT, например, при первичной загрузке) — `src/app/api/projects/[id]/files/`:
  - `GET` — список файлов проекта с метаданными (path, hash, size, type).
  - `POST` — загрузка нового файла (multipart/form-data, с указанием path).
  - `GET /[fileId]` — скачивание файла.
  - `PUT /[fileId]` — обновление содержимого (в основном для бинарных).
  - `DELETE /[fileId]` — удаление (soft).
  - `POST /move` — переименование/перемещение.
  - Все эндпоинты — с проверкой permissions, поддерживают аутентификацию по API-ключу или JWT.
- [ ] **6.5.** Реализовать историю версий файла — `GET /api/projects/[id]/files/[fileId]/versions` и `GET .../versions/[versionId]` (просмотр и скачивание конкретной версии).
- [ ] **6.6.** Лимит на размер одного файла из конфига (по умолчанию — без лимита, но добавить переменную `MAX_FILE_SIZE` на будущее).
- [ ] **6.7.** Тесты: загрузка/скачивание файла, проверка хеша, защита от path traversal, версионность.

---

## Этап 7. CRDT-слой (Yjs)

- [ ] **7.1.** Установить `yjs`, `y-protocols`.
- [ ] **7.2.** Реализовать `src/lib/crdt/persistence.ts` — Yjs-persistence в PostgreSQL:
  - сохранение Yjs-state и stateVector в `YjsDocument` (через `Y.encodeStateAsUpdate` / `Y.encodeStateVector`),
  - загрузка документа: создание `Y.Doc`, применение state из БД,
  - apply update: получает update от клиента, применяет к документу, сохраняет новое состояние.
  - **Снапшотинг** — при каждом обновлении (debounced 5 секунд) запускается фоновая задача, которая:
    - извлекает текстовое содержимое из `Y.Doc` (предполагается, что плагин кладёт текст в `Y.Text` под ключом `content`),
    - сохраняет текст в файловую систему как `.md` файл по пути `<STORAGE_PATH>/<projectId>/<filePath>`,
    - обновляет `VaultFile.contentHash` и `updatedAt`,
    - создаёт запись `FileVersion` (с разумной частотой — не каждое нажатие клавиши, например, не чаще раз в N минут или после M обновлений).
- [ ] **7.3.** Реализовать `src/lib/crdt/garbage-collection.ts` — периодическая компактификация Yjs-state (раз в сутки), чтобы БД не раздувалась.
- [ ] **7.4.** Тесты: применение update, снапшотинг, корректность текста после применения серии обновлений, восстановление документа после рестарта.

---

## Этап 8. Журнал операций и vector clock

- [ ] **8.1.** Реализовать `src/lib/sync/vector-clock.ts`:
  - структура: `Map<clientId, number>`,
  - сравнение, merge, инкремент.
- [ ] **8.2.** Реализовать `src/lib/sync/operation-log.ts`:
  - запись операции в `OperationLog` (с автором, vector clock, payload),
  - получение операций для проекта, начиная с указанного vector clock (для догона при реконнекте),
  - применение операции на сервере: вызов соответствующих storage-функций.
- [ ] **8.3.** Каждый тип операции (`CREATE`, `UPDATE`, `DELETE`, `RENAME`, `MOVE`) имеет свою структуру payload:
  - `CREATE` — path, fileType, mimeType, contentHash, size (содержимое заливается отдельно для бинарных, через CRDT для текстовых).
  - `UPDATE` — fileId (только для бинарных, у текстовых — через Yjs).
  - `DELETE` — fileId.
  - `RENAME` — fileId, newPath.
  - `MOVE` — fileId, newPath.
- [ ] **8.4.** Алгоритм разрешения конфликтов на уровне операций:
  - конкурентные `RENAME` одного файла → выигрывает операция с большим автором по lexсортировке clientId (детерминированно).
  - `DELETE` vs `UPDATE` → DELETE побеждает, но создаётся «tombstone» с возможностью восстановления.
  - `CREATE` для одного и того же `path` → файл с поздним vector clock переименовывается в `<name>.conflict-<clientId>.<ext>`.
- [ ] **8.5.** Тесты: симуляция конкурентных операций двумя клиентами, проверка детерминированности результата.

---

## Этап 9. Socket.IO сервер (отдельный процесс)

- [ ] **9.1.** Установить `socket.io`. Создать `src/socket/server.ts`:
  ```ts
  import { Server } from 'socket.io';
  // listen на PORT_SOCKET, CORS под PUBLIC_URL
  ```
- [ ] **9.2.** Реализовать аутентификацию подключений `src/socket/auth.ts`:
  - middleware на `io.use()`, читает `socket.handshake.auth.apiKey`,
  - валидирует через тот же хелпер, что и REST,
  - сохраняет `userId` в `socket.data`.
- [ ] **9.3.** Подключение к проекту:
  - событие `project:join` с `{ projectId, sinceVectorClock }`,
  - проверка прав (canViewProject),
  - `socket.join(projectRoom(projectId))`,
  - отправка операций из `OperationLog` после `sinceVectorClock`,
  - отправка Yjs sync-step1 для всех Yjs-документов проекта.
- [ ] **9.4.** События для метаданных файлов:
  - `file:create`, `file:update-binary`, `file:delete`, `file:rename`, `file:move` — клиент отправляет, сервер записывает в `OperationLog`, применяет на storage, рассылает всем в room (включая отправителя для подтверждения с серверным vector clock).
- [ ] **9.5.** События для CRDT (по протоколу `y-protocols`):
  - `yjs:sync` — sync-step1/sync-step2 (полная синхронизация документа),
  - `yjs:update` — инкрементальные обновления,
  - сервер использует `src/lib/crdt/persistence.ts` для применения.
  - Awareness (кто сейчас редактирует) — по желанию, опционально в MVP.
- [ ] **9.6.** Бинарные файлы заливаются через REST (см. этап 6), а Socket.IO рассылает только событие `file:update-binary` всем клиентам с новым `contentHash` — клиенты сами скачивают через REST.
- [ ] **9.7.** Реализовать graceful shutdown: при SIGTERM сохранить все pending Yjs-state в БД, закрыть подключения.
- [ ] **9.8.** Логирование всех событий через pino (отдельный logger в Socket-процессе).
- [ ] **9.9.** Тесты:
  - Vitest + `socket.io-client` для интеграционных тестов,
  - симуляция двух клиентов, проверка распространения событий,
  - проверка догона операций при `sinceVectorClock`.

---

## Этап 10. Админка суперадмина

- [ ] **10.1.** Layout `app/(admin)/layout.tsx` с проверкой роли `SUPERADMIN` в middleware.
- [ ] **10.2.** Страницы:
  - `/admin/users` — список всех пользователей, поиск, пагинация, действия: блокировка, удаление, смена роли, отправка приглашения, ручная верификация email.
  - `/admin/users/[id]` — детальный просмотр, история действий из AuditLog.
  - `/admin/projects` — список всех проектов, переход в любой проект.
  - `/admin/invitations` — управление приглашениями на сервер (в invite-only режиме).
  - `/admin/settings` — настройки сервера:
    - переключатель открытой регистрации,
    - SMTP-настройки (с тестовой отправкой),
    - PUBLIC_URL,
    - дефолтная роль для новых пользователей,
  - `/admin/audit-log` — журнал действий, фильтры по пользователю/типу/датам.
- [ ] **10.3.** API-эндпоинты в `src/app/api/admin/` (все требуют SUPERADMIN):
  - CRUD для пользователей, чтение всех проектов, управление настройками, просмотр audit log.
- [ ] **10.4.** Хелпер `recordAuditLog()`, вызывается из всех важных операций (создание/удаление пользователя, изменение ролей, удаление проекта, изменение настроек сервера).

---

## Этап 11. Логирование (pino)

- [ ] **11.1.** Установить `pino`, `pino-pretty` (dev), `pino-roll` (ротация в проде).
- [ ] **11.2.** Реализовать `src/lib/logger/index.ts` с двумя инстансами:
  - основной (для веба и API),
  - audit (только для аудит-событий, отдельный файл).
- [ ] **11.3.** В проде — лог в `LOG_DIR` (`/var/log/obsidian-sync`) с ротацией по 100 МБ или по дате.
- [ ] **11.4.** В Socket.IO-процессе — отдельные файлы (`socket.log`, `audit-socket.log`).
- [ ] **11.5.** Каждый запрос API логируется (method, path, status, duration, userId если есть).

---

## Этап 12. Установочный скрипт `install.sh`

- [ ] **12.1.** Скрипт `scripts/install.sh` для Ubuntu 22.04+ / Debian 12+:
  1. проверка прав root,
  2. определение ОС (через `/etc/os-release`),
  3. установка системных зависимостей: `curl`, `git`, `build-essential`, `ca-certificates`, `gnupg`,
  4. установка Node.js 20 LTS (через NodeSource),
  5. установка `pnpm` (через npm),
  6. установка PostgreSQL 16 (если не установлен), создание БД и пользователя,
  7. установка Caddy (через официальный apt-репозиторий),
  8. интерактивный запрос у пользователя:
     - домен (`PUBLIC_URL`),
     - email и пароль супер-админа,
     - SMTP настройки (опционально),
     - открытая регистрация (yes/no),
  9. клонирование репо в `/opt/obsidian-sync` (если не вызван из-под него),
  10. `pnpm install --prod=false`, `pnpm build`,
  11. генерация `.env` с заполненными значениями и сгенерированными секретами JWT,
  12. `pnpm prisma migrate deploy`, `pnpm tsx prisma/seed.ts`,
  13. создание PM2 ecosystem-файла из шаблона,
  14. установка PM2 глобально, `pm2 start ecosystem.config.js`,
  15. сохранение списка процессов: `pm2 save`,
  16. настройка systemd unit для PM2: `pm2 startup`,
  17. генерация `Caddyfile` из шаблона, копирование в `/etc/caddy/Caddyfile`,
  18. рестарт Caddy: `systemctl reload caddy`,
  19. вывод итоговых данных: URL, email админа.
- [ ] **12.2.** Сделать скрипт идемпотентным: повторный запуск не ломает существующую установку, предлагает upgrade-режим.
- [ ] **12.3.** Создать `scripts/uninstall.sh` для удаления (с подтверждением и опцией сохранения `STORAGE_PATH` и БД).
- [ ] **12.4.** Создать `scripts/upgrade.sh` — обновление: `git pull`, `pnpm install`, `pnpm build`, `pnpm prisma migrate deploy`, `pm2 reload all`.

---

## Этап 13. Конфигурация Caddy и PM2

- [ ] **13.1.** Создать `config/Caddyfile.example`:

  ```
  {$DOMAIN} {
      encode gzip zstd

      # Socket.IO
      handle /socket.io/* {
          reverse_proxy localhost:3001
      }

      # Next.js всё остальное
      handle {
          reverse_proxy localhost:3000
      }

      log {
          output file /var/log/caddy/access.log
      }
  }
  ```

- [ ] **13.2.** Создать `ecosystem.config.js` для PM2:
  ```js
  module.exports = {
    apps: [
      {
        name: 'obsidian-sync-web',
        script: 'node_modules/next/dist/bin/next',
        args: 'start -p 3000',
        instances: 1,
        env: { NODE_ENV: 'production' },
        error_file: '/var/log/obsidian-sync/web.error.log',
        out_file: '/var/log/obsidian-sync/web.out.log',
      },
      {
        name: 'obsidian-sync-socket',
        script: 'dist/socket/server.js',
        instances: 1,
        env: { NODE_ENV: 'production' },
        error_file: '/var/log/obsidian-sync/socket.error.log',
        out_file: '/var/log/obsidian-sync/socket.out.log',
      },
    ],
  };
  ```
- [ ] **13.3.** Скрипт сборки Socket.IO-процесса: `tsup src/socket/server.ts --format esm --out-dir dist/socket` (или `tsc` под отдельный `tsconfig.socket.json`).
- [ ] **13.4.** В `package.json` добавить scripts:
  ```json
  {
    "dev": "concurrently \"pnpm:dev:web\" \"pnpm:dev:socket\"",
    "dev:web": "next dev",
    "dev:socket": "tsx watch src/socket/server.ts",
    "build": "next build && pnpm build:socket",
    "build:socket": "tsup src/socket/server.ts --format esm --out-dir dist/socket",
    "start": "pm2 start ecosystem.config.js"
  }
  ```

---

## Этап 14. Документация и финал

- [ ] **14.1.** Заполнить `README.md` сервера:
  - что делает,
  - быстрый старт через `install.sh`,
  - ручная установка для тех, кто не хочет скрипт,
  - переменные окружения и их описание,
  - управление PM2 (рестарт, логи, обновление),
  - troubleshooting (проблемы с SMTP, Caddy, PostgreSQL).
- [ ] **14.2.** Создать `docs/architecture.md` — архитектурный обзор: процессы, схема БД, протокол синхронизации.
- [ ] **14.3.** Создать `docs/api.md` — описание REST-эндпоинтов и Socket.IO событий с примерами запросов/ответов. (Опционально — генерировать через OpenAPI.)
- [ ] **14.4.** Создать `docs/sync-protocol.md` — детальное описание протокола, нужное разработчикам плагина.
- [ ] **14.5.** Создать `CONTRIBUTING.md` со стандартами кода и процессом PR.
- [ ] **14.6.** Создать `CHANGELOG.md`. Использовать Conventional Commits для генерации.
- [ ] **14.7.** Покрыть критичные пути e2e-тестами Playwright:
  - регистрация → создание проекта → приглашение второго пользователя → принятие → второй пользователь видит проект.
  - админка: SUPERADMIN видит всех пользователей и может изменить роль.
- [ ] **14.8.** Прогнать финальные тесты, проверить, что `install.sh` корректно работает на чистом VPS (можно через локальную VM с Ubuntu).

---

## Критерии готовности серверной части

После завершения всех этапов сервер должен:

- ✅ Устанавливаться на чистый Ubuntu/Debian VPS одной командой (`./install.sh`).
- ✅ Иметь работающий HTTPS через Caddy (Let's Encrypt автоматически).
- ✅ Поддерживать оба режима регистрации (открытая / по приглашению), переключаемые в админке.
- ✅ Принимать API-ключи и JWT, корректно проверять права на проектах.
- ✅ Хранить файлы в FS, метаданные и Yjs-state в PostgreSQL.
- ✅ Принимать подключения по Socket.IO, рассылать события по rooms проектов.
- ✅ Хранить историю изменений с автором каждой версии.
- ✅ Иметь работающую админку для управления пользователями, проектами, приглашениями, настройками.
- ✅ Логировать все события в файлы с ротацией.
- ✅ Иметь покрытие тестами ≥ 70% по бизнес-логике.

После выполнения всех задач — переходить к разработке плагина (`obsidian-plugin/tasks.md`).
