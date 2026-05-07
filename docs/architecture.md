# Архитектура серверной части

## Общий вид

```
                                ┌──────────────────────────────────┐
   HTTPS / WSS                  │            Caddy :443            │
  (клиент) ─────────────────────┤  reverse-proxy + auto-Let's-     │
                                │  Encrypt                         │
                                └────────┬─────────────────┬───────┘
                                         │                 │
                                  /socket.io/*           всё остальное
                                         │                 │
                              ┌──────────▼────────┐  ┌─────▼──────────────┐
                              │  socket процесс   │  │   Next.js (web)    │
                              │  Socket.IO + Yjs  │  │   App Router + API │
                              │  PM2: socket      │  │   PM2: web         │
                              │  Node.js :3001    │  │   Node.js :3000    │
                              └──────────┬────────┘  └─────┬──────────────┘
                                         │                 │
                                         └────────┬────────┘
                                                  │
                                          ┌───────▼────────┐
                                          │  PostgreSQL 16 │
                                          │   + Prisma     │
                                          └───────┬────────┘
                                                  │
                                          ┌───────▼────────────────┐
                                          │  /var/lib/obsidian-    │
                                          │  sync (FS storage)     │
                                          └────────────────────────┘
```

## Процессы

| Процесс    | Порт | Cтек                                          | Что делает                                                                                                                                                                                                |
| ---------- | ---- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **web**    | 3000 | Next.js 16 (App Router, RSC, Turbopack в dev) | REST API (`/api/...`), серверный рендеринг страниц (`(public)`, `(app)`, `(admin)`), Server Components, аутентификация через cookies, `/api/auth/*`, `/api/projects/*`, `/api/api-keys/*`, `/api/admin/*` |
| **socket** | 3001 | Socket.IO 4 + Yjs 13                          | Realtime: `project:join` с catch-up из `OperationLog` и Yjs sync, `file:*` события, `yjs:update`                                                                                                          |

Оба процесса:

- общаются с **одним** PostgreSQL через Prisma (driver-adapter `@prisma/adapter-pg`);
- читают и пишут в **одно** хранилище файлов (`STORAGE_PATH`);
- используют общий код из `src/lib/` (auth, files, crdt, sync, email, logger).

PM2 управляет обоими, у каждого свой `OSYNC_PROCESS` env — это переключает
имена файлов логов в `src/lib/logger/index.ts`:

- web → `web.log` + `audit.log`
- socket → `socket.log` + `audit-socket.log`

## Потоки данных

### 1. Регистрация / вход

```
Browser → POST /api/auth/register
  ⤷ password hash via bcrypt(12)
  ⤷ email verification token (24h) → emails.log / SMTP
Browser ← 201
…
Browser → POST /api/auth/verify-email { token }
  ⤷ User.emailVerified = now
Browser → POST /api/auth/login
  ⤷ bcrypt.compare
  ⤷ issue access (15m) + refresh (30d, jti) → cookies osync_access / osync_refresh
  ⤷ DB: RefreshToken row with sha256(jti) hash
Browser ← { accessToken, user }
```

`proxy.ts` (бывший middleware) защищает `/dashboard`, `/profile`, `/api-keys`,
`/projects/*`, `/admin/*`. Edge runtime — поэтому `verifyAccessToken` импортируется
из тонкого модуля `jwt-verify.ts` без `node:crypto`.

### 2. Файловые операции (плагин)

Плагин аутентифицируется через X-API-Key (или JWT через session cookie — для
веб-клиента). Пишет файлы:

```
Plugin → POST /api/projects/:id/files (multipart)
  ⤷ authenticateRequest() — пробует X-API-Key, потом cookies
  ⤷ permissions.canEditFiles
  ⤷ writeProjectFile(projectId, path, buffer) — atomic temp+rename
  ⤷ Prisma: VaultFile row (BigInt size, contentHash, fileType)
  ⤷ recordFileVersion() — snapshot в .versions/<fileId>/<n>.snapshot + FileVersion row
Plugin ← 201 { file }
```

Для realtime (текстовые файлы) плагин:

```
Plugin ↔ wss://.../socket.io  (auth: { apiKey })
  ↦ project:join { projectId, sinceVectorClock }
  ↤ ack { operations[], yjsDocs[] }       — catch-up
  ↦ yjs:update { fileId, update[] }       — каждое локальное изменение
  ↤ yjs:update { fileId, update[] }       — broadcast от других peers
  ↦ file:create / file:rename / ...        — метаданные через OperationLog
```

### 3. CRDT (текстовый файл, многопользовательский)

Каждый текстовый `VaultFile` имеет 1:1 `YjsDocument` со state.

```
applyYjsUpdate({ fileId, update, authorId })
  1. loadYjsDoc(fileId)         — Y.applyUpdate(doc, dbState)
  2. Y.applyUpdate(doc, update) — мерж с клиентским апдейтом
  3. compare state vectors      — определить, изменился ли документ
  4. upsert YjsDocument         — сохранить новые state + stateVector
  5. extract Y.Text 'content'   — для downstream snapshot
  6. broadcast другим peers через socket.to(projectRoom)
  7. scheduleSnapshot(5s)       — debounced запись .md файла + FileVersion
```

GC (раз в день, ручной cron): `compactAllYjsDocuments` → `Y.encodeStateAsUpdate`
коллапсирует internal struct stores.

## Схема БД

16 моделей + 4 enum. Полная схема в [`prisma/schema.prisma`](../prisma/schema.prisma).

### Группы моделей

```
auth:        User, EmailVerificationToken, PasswordResetToken, RefreshToken, ApiKey
projects:    Project, ProjectMember, ProjectInvitation, ServerInvitation
files:       VaultFile, YjsDocument, FileVersion
sync:        OperationLog
audit:       AuditLog
config:      ServerConfig (key/value JSON)
```

### Каскады удаления

- `User` → токены и api-keys: **Cascade**.
- `User` (как owner) → `Project`: **Restrict** (нужно сначала переназначить владение или удалить проекты — защита от случайного потери всех проектов).
- `User` (`addedBy` / `invitedBy` / `author` / `lastModifiedBy`) → `SetNull` (сохраняем историю).
- `Project` → `ProjectMember`, `ProjectInvitation`, `VaultFile`, `OperationLog`: **Cascade**.
- `VaultFile` → `YjsDocument`, `FileVersion`: **Cascade**.

### Уникальные индексы

- `User.email`
- `Project.slug`
- `(ProjectMember.projectId, userId)`
- `(VaultFile.projectId, path)`
- `(FileVersion.fileId, versionNumber)`
- `RefreshToken.tokenHash`
- `ApiKey.keyHash`

## Хранилище файлов

```
${STORAGE_PATH}/
├── <projectId-1>/
│   ├── note.md                     ← snapshot Y.Text content (для читаемости снаружи)
│   ├── folder/
│   │   └── nested.md
│   └── .versions/                  ← снапшоты для истории версий
│       └── <fileId>/
│           ├── 1.snapshot
│           └── 2.snapshot
└── <projectId-2>/
    └── …
```

- Все записи **атомарны** (`<target>.<random>.tmp` → `rename()`).
- Path-валидация в [`src/lib/files/paths.ts`](../src/lib/files/paths.ts) запрещает `..`, абсолютные пути, NUL, зарезервированную папку `.versions/`. Проверка двойная: на уровне `normalizeVaultPath` и через `path.relative()` от project root.

## Аутентификация и авторизация

### Уровни

1. **Session (cookie)** — для веб-клиента. `osync_access` (httpOnly, SameSite=Lax, secure в проде, 15m) + `osync_refresh` (30d).
2. **API key (X-API-Key header)** — для плагина и сторонних интеграций. Формат `osync_<64hex>`. В БД хранится bcrypt-хеш + 12-символьный prefix для быстрого поиска.

`authenticateRequest(request)` (Stage 6, `src/lib/auth/authenticate.ts`) пытается
сначала API-ключ, потом session — это позволяет одним и тем же роутам обслуживать
оба клиента.

### Permission helpers

`src/lib/auth/permissions.ts`:

| Функция                  | Кто `true`                       |
| ------------------------ | -------------------------------- |
| `canViewProject`         | owner, любой member, SUPERADMIN  |
| `canEditFiles`           | owner, ADMIN, EDITOR, SUPERADMIN |
| `canManageMembers`       | owner, ADMIN, SUPERADMIN         |
| `canEditProjectMetadata` | то же, что `canManageMembers`    |
| `canDeleteProject`       | owner, SUPERADMIN                |

`isSuperAdmin(user)` всегда true для SUPERADMIN role.

## Vector clock и резолюция конфликтов

`src/lib/sync/vector-clock.ts` — `Record<clientId, counter>`.

`compare(a, b) → 'before' | 'after' | 'equal' | 'concurrent'`.

При concurrent операциях:

- **CREATE же на тот же path**: проигравший переименовывается в `<base>.conflict-<clientId>.<ext>`.
- **DELETE > UPDATE**: если файл — tombstone (`deletedAt`), `UPDATE` становится `no_op` с пометкой `suppressed: 'tombstone'` в payload.
- **Concurrent RENAME в один target**: второй RENAME уходит в `target.conflict-<clientId>.<ext>`.

Подробнее — в [`docs/sync-protocol.md`](./sync-protocol.md).

## Логирование

Pino + pino-roll. Файлы (всё в `${LOG_DIR}`):

| Файл                         | Источник                                                        |
| ---------------------------- | --------------------------------------------------------------- |
| `web.log`                    | основной web-процесс (API, SSR)                                 |
| `audit.log`                  | `recordAuditLog` из web — admin actions, изменения ролей и т.д. |
| `socket.log`                 | основной socket-процесс                                         |
| `audit-socket.log`           | `recordAuditLog` из socket (если будет вызываться оттуда)       |
| `pm2-web.{out,error}.log`    | stdout/stderr Next.js (start-up + crashes)                      |
| `pm2-socket.{out,error}.log` | stdout/stderr socket-процесса                                   |

Ротация: 100 MB **или** ежедневно (что наступит раньше). Хранится 14 файлов.
Имена ротированных файлов с суффиксом `yyyy-MM-dd`.

`recordAuditLog` пишет одновременно в `audit.log` и в DB-таблицу `AuditLog`
(чтобы `/admin/audit-log` мог его выводить с фильтрами). Никогда не throw'ится.

## Тестовая стратегия

```
                                  Стоимость теста
                        быстрые ──────────────────► медленные
   ┌──────────┐         ┌─────────────────┐         ┌────────────┐
   │   Unit   │ ──────► │   Integration   │ ──────► │     E2E    │
   │  Vitest  │         │  Vitest + DB    │         │ Playwright │
   └──────────┘         └─────────────────┘         └────────────┘
   pure logic           Prisma, FS, Yjs              full HTTP/WS
   <1s total            ~10s total                   ~30s total
```

- **48 unit-тестов** в `src/**/*.test.ts(x)` и `tests/unit/`.
- **58 integration-тестов** в `tests/integration/` (DB через `obsidian_sync_test`).
- **19 e2e-тестов** в `tests/e2e/` (Playwright поднимает `pnpm dev` изолированно).

Полный набор: `pnpm test:all && pnpm test:e2e`.
