# Лог разработки серверной части

Новые записи — сверху. Формат: `[YYYY-MM-DD HH:MM] этап.номер — описание`.

---

## 2026-05-06

- **[2026-05-06] Этап 11 ЗАВЕРШЁН.** Логирование (pino + ротация + audit). Все проверки чисты:
  - `format:check` / `typecheck` / `lint` — 0 проблем.
  - `pnpm test` — **48/48** unit (+3 для `withApiLogger`).
  - `pnpm test:integration` — **58/58**.
  - `pnpm test:e2e` — **19/19**.

- **[2026-05-06] 11.5 — Request logging (`withApiLogger`).**
  - `src/lib/logger/http.ts` — `withApiLogger(handler)` оборачивает route-handler и логирует строку `api.request` с `{ http: { method, path, status, durationMs } }`. Уровень `error` для ≥500, `warn` для ≥400, иначе `info`. Если handler выбрасывает — логируется `api.unhandled` и err пробрасывается.
  - Применено к `auth/login` и `auth/register` как демонстрация (через `export const POST = withApiLogger(async function POST(...) { ... });`). **На production access-логи всех запросов также пишет Caddy** (`output file /var/log/caddy/access.log` — будет настроено на Этапе 13.1), так что массовое оборачивание не требуется.

- **[2026-05-06] 11.2 / 11.3 / 11.4 — Logger split + ротация.**
  - `src/lib/logger/index.ts` поддерживает 4 «вида»: `web` / `audit` / `socket` / `audit-socket`. Выбор делается по `process.env.OSYNC_PROCESS === 'socket'` (выставляется в PM2 ecosystem на Этапе 13).
  - Файлы в production: `${LOG_DIR}/web.log`, `${LOG_DIR}/audit.log`, `${LOG_DIR}/socket.log`, `${LOG_DIR}/audit-socket.log`.
  - Ротация через `pino-roll`: `size: '100m'`, `frequency: 'daily'`, `limit: 14`, `dateFormat: 'yyyy-MM-dd'`, `mkdir: true`.
  - В dev — `pino-pretty` с цветом и `SYS:HH:MM:ss`. В тестах (`NODE_ENV=test`) — silent.
  - Каждая запись имеет `base.kind` для фильтрации в pipeline.

- **[2026-05-06] audit-logger подключён к `recordAuditLog`.**
  - `recordAuditLog` теперь пишет в **два места одновременно**: (1) файл `audit.log` через `auditLogger.info(...)` (структурированный JSON, ротация); (2) DB-таблица `AuditLog` (доступна через `/admin/audit-log`). DB-failure не throw'ится (логируется warning'ом в основной log).

- **[2026-05-06] 11.1 — `pino-roll@4.0.0` установлен.**

- **[2026-05-06] eslint config.** Добавлено правило `@typescript-eslint/no-unused-vars` с `argsIgnorePattern: '^_'` (callback-сигнатуры с unused-by-design параметрами теперь не ругаются).

- **[2026-05-06] Этап 10 ЗАВЕРШЁН.** Админка суперадмина. Все проверки чисты:
  - `format:check` / `typecheck` / `lint` — 0 проблем.
  - `pnpm test` — **45/45** unit. `test:integration` — **58/58**. `test:e2e` — **19/19** (+4 admin-flow).

- **[2026-05-06] Schema migration.** Добавлено поле `User.disabledAt: DateTime?` (миграция `20260506091026_user_disabled`). Применено на dev и test БД. При блокировке через `PATCH /api/admin/users/[id] { disabled: true }` — выставляется + revoke всех refresh-токенов пользователя.

- **[2026-05-06] 10.4 — `recordAuditLog` + `requireSuperAdmin`.**
  - `src/lib/audit/record.ts` — `recordAuditLog({ userId, action, entityType, entityId?, metadata?, ip?, userAgent? })`. Failures логируются через pino, но не throw'ятся (audit не должен блокировать primary actions).
  - `src/lib/auth/admin.ts` — `requireSuperAdmin()` возвращает `{ ok: true, user }` или `{ ok: false, response }` (401/403). Все `/api/admin/*` начинаются с этой проверки.

- **[2026-05-06] 10.3 — REST API `/api/admin/*`.**
  - `GET /api/admin/users` — search + pagination (page/pageSize). Returns user list + counts (`ownedProjects`, `memberships`).
  - `POST /api/admin/users` — создание с `email/name/password/role`, `emailVerified=now`. P2002 → 409 `email_taken`. Audit: `admin.user.create`.
  - `GET /api/admin/users/[id]` — детали + последние 50 записей `AuditLog` пользователя.
  - `PATCH /api/admin/users/[id]` — изменение `role`, `disabled`, `emailVerified`, `name`. При `disabled: true` — revoke refresh-tokens. Audit: `admin.user.update`.
  - `DELETE /api/admin/users/[id]` — удаление. Защита от self-delete (`cannot_delete_self`). При FK-конфликте (есть проекты в собственности — `Restrict` от Этапа 1) — 409 `has_owned_projects`. Audit: `admin.user.delete`.
  - `GET /api/admin/projects` — все проекты с владельцем и `_count.members/files`, `search` по name/slug.
  - `GET /api/admin/invitations` — активные `ServerInvitation`. `POST` — выпуск нового (32 hex, 14 дней TTL, отправка email через `serverInvitationMessage`, 409 если email уже зарегистрирован). `DELETE /[id]` — отзыв. Audit: `admin.invitation.create/revoke`.
  - `GET /api/admin/settings` — читает `ServerConfig` ключи `openRegistration / smtpEnabled / defaultUserRole / publicUrl`. `PATCH` — upsert через transaction. Audit: `admin.settings.update`.
  - `GET /api/admin/audit-log` — фильтры `userId / action(contains) / entityType / from / to`, pagination. Returns `entries` + `total`.

- **[2026-05-06] 10.2 — Admin UI.**
  - `(admin)/layout.tsx` (с Этапа 3) расширен: `AppHeader` + новый `AdminSidebar` (Users / Projects / Invitations / Settings / Audit Log).
  - `/admin` — server-side redirect на `/admin/users`.
  - `/admin/users` — таблица с поиском, кнопки **«Верифицировать email»** / **«Заблокировать/Разблокировать»** / **«Удалить»** (через ConfirmDialog).
  - `/admin/users/[id]` — карточка статистики (ownedProjects, memberships, apiKeys) + таблица последних 50 записей `AuditLog` пользователя.
  - `/admin/projects` — таблица всех проектов с поиском, link на `/projects/[id]`.
  - `/admin/invitations` — форма создания + таблица активных + copy-to-clipboard для URL + отзыв.
  - `/admin/settings` — три карточки (openRegistration, smtpEnabled, publicUrl) с одной общей кнопкой Save.
  - `/admin/audit-log` — таблица + 5 фильтров (userId / action / entityType / from / to) с datetime-local пикерами.
  - i18n строки добавлены в раздел `admin.*`.

- **[2026-05-06] 10.7 (5) — Тесты.**
  - `tests/e2e/admin-flow.spec.ts` — 4 кейса: (1) regular USER → 403 на `/api/admin/*`, (2) SUPERADMIN: list users → promote target → block → audit log содержит обе записи + verifies refresh-token revoked, (3) settings PATCH/GET roundtrip, (4) server-invitation create + revoke.

- **[2026-05-06] Этап 9 ЗАВЕРШЁН.** Socket.IO сервер. Все проверки чисты:
  - `format:check` / `typecheck` / `lint` — 0 проблем.
  - `pnpm test` — **45/45** unit (без новых).
  - `pnpm test:integration` — **58/58** (+7 socket: auth × 3 + project:join × 2 + file:create broadcast + yjs:update persist+broadcast).

- **[2026-05-06] 9.9 — Тесты client ↔ server.**
  - `tests/integration/socket/socket-server.test.ts` — поднимает `httpServer.listen(0, '127.0.0.1')` (random port), `createIoServer({ httpServer, corsOrigin: '*' })`, реальный `socket.io-client` подключается с `auth.apiKey`. Покрытие:
    1. **Auth:** без ключа / с malformed ключом → `connect_error`; с валидным → `connect`.
    2. **project:join:** возвращает `OperationLog` после `sinceVectorClock` и список Yjs sync-1 для каждого текстового файла.
    3. **project:join forbidden:** не-участник получает `{ ok: false, error: 'forbidden' }`.
    4. **file:create broadcast:** подключаются два клиента (owner + EDITOR), оба джойнятся в room, owner создаёт файл, EDITOR получает `file:created` event с outcome.
    5. **yjs:update:** клиент шлёт `Y.encodeStateAsUpdate`, сервер применяет, persist в БД, эмитит другим клиентам в room. Reload `Y.Doc` из БД даёт ожидаемый текст.

- **[2026-05-06] 9.7 — Graceful shutdown.**
  - `runStandaloneServer()` ловит `SIGTERM` и `SIGINT`. Алгоритм: `io.close()` (новые подключения отвергаются) + `httpServer.close()` + `fetchSockets()` для disconnect всех текущих + `prisma.$disconnect()`. Логируется через pino.

- **[2026-05-06] 9.5 — `src/socket/handlers/yjs.ts`.**
  - `yjs:update` — клиент шлёт `{ projectId, fileId, update: number[] }`.
  - Auth: проверка `canEditFiles`, что файл принадлежит проекту и не tombstone.
  - Применяет через `applyYjsUpdate` (Этап 7) — обновление persist'ится в `YjsDocument`. Если `changed: true`, бродкаст другим клиентам в room (без отправителя через `socket.to(...)`) + `scheduleSnapshot` на debounced запись `.md` + `FileVersion`.
  - Ack: `{ ok, changed }`.

- **[2026-05-06] 9.4 — `src/socket/handlers/files.ts`.**
  - События: `file:create`, `file:update-binary`, `file:delete`, `file:rename`, `file:move` — все обёрнуты `withEditAccess` (load access + check role + canEditFiles).
  - Каждое событие вызывает `applyOperation` (Этап 8) c `vectorClock = increment(parseClock(raw.vectorClock), clientId)`. После успеха — broadcast в `projectRoom(projectId)` (всем включая отправителя — для подтверждения с серверным VC) события `file:created` / `file:updated-binary` / `file:deleted` / `file:renamed` / `file:moved`.
  - Бинарные данные передаются как `number[]` (упрощение JSON-сериализации). На production-канале можно перейти на base64 / Buffer.

- **[2026-05-06] 9.3 — `src/socket/handlers/project.ts`.**
  - `project:join { projectId, sinceVectorClock? }`:
    - `loadProjectAccess` + `canViewProject`,
    - `socket.join(projectRoom(projectId))`,
    - **catch-up:** `listOperationsSince` → массив операций для применения клиентом,
    - **Yjs sync-1:** для каждого `YjsDocument` проекта — энкодит `Y.encodeStateAsUpdate` (полный state), клиент мерджит со своим локальным состоянием,
    - ack: `{ ok: true, operations, yjsDocs }`.
  - `project:leave` — `socket.leave(...)`.

- **[2026-05-06] 9.2 — `src/socket/auth.ts`.**
  - `installAuthMiddleware(io)` через `io.use()`. Читает `apiKey` из `socket.handshake.auth.apiKey` (приоритет) или `x-api-key` header. Валидирует через `isWellFormedApiKey` + `authenticateApiKey` (тот же путь, что в REST API). На успех — кладёт `{ userId, apiKeyId }` в `socket.data`.
  - `getSocketUser(socket)` — type-safe accessor (без module-augmentation, потому что `socket.data` контролируется через `Server` generic'и, а не глобально).
  - `projectRoom(projectId)` — единый хелпер для room-имён.

- **[2026-05-06] 9.1 — База Socket.IO + logger.**
  - `socket.io@4.8.3` + `socket.io-client@4.8.3` (dev). `pino@10.3.1` + `pino-pretty@13.1.3` (dev).
  - `src/lib/logger/index.ts` — pino logger, в проде — JSON, в dev — pino-pretty с цветом и коротким временем. `LOG_LEVEL` из env.
  - `src/socket/server.ts` — `createIoServer({ httpServer?, corsOrigin? })` фабрика (тестируемая), `runStandaloneServer({ port? })` для запуска как отдельного процесса. CORS из `PUBLIC_URL`. `maxHttpBufferSize: 16MB`.

- **[2026-05-06] Этап 8 ЗАВЕРШЁН.** Журнал операций и vector clock. Все проверки чисты:
  - `format:check` / `typecheck` / `lint` — 0 проблем.
  - `pnpm test` — **45/45** unit (+6 vector-clock).
  - `pnpm test:integration` — **51/51** (+8 operation-log: appendConflictSuffix × 3 + CREATE-collision + DELETE>UPDATE + concurrent-RENAME + listSince ×2).

- **[2026-05-06] 8.5 — Тесты.**
  - **vector-clock** — `increment`, `merge`, `compare` (before/after/equal/concurrent), `parseClock` фильтрует невалидное.
  - **operation-log integration:**
    1. `CREATE` пишет файл в storage и создаёт `VaultFile`.
    2. **CREATE-vs-CREATE collision** — второй клиент получает `path.conflict-<clientId>.<ext>`. На диске два файла, оба зарегистрированы в БД.
    3. **DELETE wins** — `UPDATE` после `DELETE` возвращает `no_op` (с `suppressed: 'tombstone'` в payload), `contentHash` остаётся прежним.
    4. **Concurrent RENAME** — второй RENAME в занятый путь автоматически уходит в `target.conflict-<clientId>.<ext>`.
    5. `listOperationsSince` отдаёт только операции, чей vector clock хоть в одной координате превышает `since`.

- **[2026-05-06] 8.4 — Алгоритм разрешения конфликтов на уровне операций.**
  - **CREATE-collision:** при попытке создать файл с уже существующим `path` → новый файл сохраняется как `<base>.conflict-<clientId>.<ext>` (хелпер `appendConflictSuffix`). Sanitize clientId: only `[A-Za-z0-9_-]`, ≤ 32 символа.
  - **DELETE > UPDATE:** если файл уже tombstone (есть `deletedAt`), `UPDATE` записывается в журнал, но не применяется к storage и БД. Outcome — `no_op` с `suppressed: 'tombstone'`. Tombstone сохраняет историю и позволяет восстановление.
  - **Concurrent RENAME:** если новая path уже занята другим файлом → текущая операция переименовывает свой файл в `<newPath>.conflict-<clientId>.<ext>`. Это делает резолюцию детерминированной по clientId без явного сравнения vector clocks.

- **[2026-05-06] 8.2 / 8.3 — `src/lib/sync/operation-log.ts`.**
  - **Payload-типы для каждой операции:** `CreatePayload`, `UpdatePayload`, `DeletePayload`, `RenamePayload`, `MovePayload`. `OperationInput` — discriminated union по `opType`.
  - `applyOperation(ctx, op)` — единая точка входа, диспатчит на `applyCreate` / `applyUpdate` / `applyDelete` / `applyMove`. Возвращает `ApplyResult { outcome, log }` с типизированным outcome (`created` / `updated` / `deleted` / `renamed` / `conflict_create_renamed` / `no_op`).
  - Каждая ветка пишет файл/выполняет операцию в storage И записывает строку в `OperationLog` в transaction-friendly порядке (storage operations idempotent).
  - `listOperationsSince({ projectId, since, limit? })` — отдаёт операции, чей `vectorClock` имеет хотя бы одну координату больше, чем в `since`. Filtering на стороне приложения после `findMany` по createdAt — упрощённый upper bound, точнее можно сделать на уровне SQL/JSON в будущем.

- **[2026-05-06] 8.1 — `src/lib/sync/vector-clock.ts`.**
  - `VectorClock = Record<clientId, counter>` — JSON-сериализуемый map.
  - `emptyClock`, `increment`, `merge` (element-wise max), `compare` (`before`/`after`/`equal`/`concurrent`), `happensBefore`, `isConcurrent`, `parseClock` (фильтрует невалидные значения из БД).

- **[2026-05-06] Этап 7 ЗАВЕРШЁН.** CRDT-слой (Yjs). Все проверки чисты:
  - `format:check` / `typecheck` / `lint` — 0 проблем.
  - `pnpm test` — **39/39** unit (+3: convergence sanity, buildInitialState, hashText).
  - `pnpm test:integration` — **43/43** (+7 в `crdt/persistence.test.ts`: applyYjsUpdate creates/accumulates/restart/idempotent, persistTextSnapshot writes+dedupes, compactYjsDocument сохраняет семантику).
  - `pnpm test:e2e` — **15/15** (без новых; CRDT покрыт integration'ом).

- **[2026-05-06] 7.4 — Тесты CRDT.**
  - **Convergence sanity** — два клиента, мердж в разном порядке → одинаковый результат.
  - **applyYjsUpdate** — создание `YjsDocument`, накопление текста, восстановление после имитации перезапуска (только из БД), идемпотентность повторного апдейта (`changed=false`).
  - **persistTextSnapshot** — записывает `<storage>/<projectId>/<file.path>` и создаёт `FileVersion`. Повторный snapshot с тем же контентом возвращает `versionNumber: null` (через `recordFileVersion`).
  - **compactYjsDocument** — после 16 последовательных апдейтов и компактификации текст идентичен.

- **[2026-05-06] 7.3 — `src/lib/crdt/garbage-collection.ts`.**
  - `compactYjsDocument(fileId)` — re-encode через `encodeStateAsUpdate` (Yjs автоматически коллапсирует internal struct stores). No-op если результат не меньше.
  - `compactAllYjsDocuments({ batchSize, onProgress })` — cursor-based pagination для cron-подобного прохода без загрузки всех байтов сразу.

- **[2026-05-06] 7.2 — `src/lib/crdt/persistence.ts`.**
  - **Конвенция:** один `Y.Text` под ключом `'content'` (`TEXT_KEY`). Плагин Obsidian обязан использовать тот же ключ.
  - `loadYjsDoc(fileId)` — загружает `state` из `YjsDocument`, применяет к свежему `Y.Doc`. Пустой doc если строки нет.
  - `applyYjsUpdate({ fileId, update, authorId })`:
    - грузит, применяет update, сравнивает state-vector до/после → устанавливает `changed`,
    - сохраняет новый `state` + `stateVector` через `upsert`,
    - возвращает извлечённый `text` для downstream (snapshot/broadcast).
  - `persistTextSnapshot({ projectId, fileId, text, authorId })` — атомарная запись `.md` через `writeProjectFile`, обновление `VaultFile.contentHash/size/lastModifiedById`, `recordFileVersion` с дедупом по хешу.
  - `scheduleSnapshot({ ..., delayMs? })` — debounced (default 5s, env `YJS_SNAPSHOT_DEBOUNCE_MS`). In-memory `Map<fileId, Timeout>`. `timer.unref()` чтобы pending snapshot не держал процесс. На multi-process деплое потребуется shared scheduler (Redis / cron).
  - `buildInitialState(text)` — для конвертации существующего `.md` в CRDT-текстовый файл при первой инициализации.

- **[2026-05-06] 7.1 — Зависимости.** `yjs@13.6.30` + `y-protocols@1.0.7`.

- **[2026-05-06] Этап 6 ЗАВЕРШЁН.** Хранение файлов на сервере. Все проверки чисты:
  - `format:check` / `typecheck` / `lint` — 0 проблем.
  - `pnpm test` — **36/36** unit (+11: paths × 9 + hash × 2).
  - `pnpm test:integration` — **36/36** (+7: storage atomic write, traversal, move/delete idempotency, list excludes `.versions`).
  - `pnpm test:e2e` — **15/15** (+4 в `files-flow.spec.ts`: full upload→download→update→version-list→read-old-version→move→delete, X-API-Key auth, traversal blocked, viewer 403).

- **[2026-05-06] 6.7 — Тесты.**
  - Unit: `paths.test.ts` (нормализация, traversal, абсолютные, NUL, .versions, длина), `hash.test.ts` (buffer + streaming совпадают).
  - Integration: `tests/integration/files/storage.test.ts` (через временную `mkdtemp` папку — атомарная запись, list без `.versions`, move/delete idempotency, traversal throws).
  - E2E: реальный multipart upload через Playwright `request.newContext`, проверка двойной аутентификации (cookies + X-API-Key), permissions (VIEWER → 403 при upload), path traversal → 400.

- **[2026-05-06] 6.5 — `/api/projects/[id]/files/[fileId]/versions` (GET) + `/versions/[versionId]` (GET).**
  - Список — DESC по `versionNumber` с автором (`User { id, name, email }`).
  - Скачивание версии стримит из `.versions/<fileId>/<n>.snapshot`. В заголовке `x-content-hash`.

- **[2026-05-06] 6.4 — REST API файлов.**
  - `/api/projects/[id]/files`:
    - `GET` — список (включая soft-deleted при `?includeDeleted=true`); `BigInt size` сериализуется как string.
    - `POST` — multipart/form-data (`path` + `file`). Auto-detect MIME через `mime-types`, классификация TEXT vs BINARY (txt/md/json/yml/yaml/csv → TEXT, иначе BINARY). При успехе создаётся `VaultFile` + первая `FileVersion` через `recordFileVersion`. P2002 → 409 `path_exists`.
  - `/api/projects/[id]/files/[fileId]`:
    - `GET` — стрим контента с правильным `content-type` и `content-length`.
    - `PUT` — обновление content (raw body), новая версия фиксируется только если хеш изменился.
    - `PATCH` — переименование/перемещение (`{ newPath }`).
    - `DELETE` — soft delete (выставляет `deletedAt`, физический файл удаляется).
  - **Аутентификация:** `authenticateRequest()` — пробует `X-API-Key` (`authenticateApiKey`), затем session cookie. Возвращает `AuthenticatedActor { id, email, name, role }`, совместимый с permission-хелперами.

- **[2026-05-06] 6.6 — Лимит и dual auth.**
  - `getMaxFileSize()` читает `MAX_FILE_SIZE` env (число или null). При превышении → 400 `file_too_large`.
  - Module: `src/lib/auth/authenticate.ts` (`authenticateRequest`, `getMaxFileSize`).

- **[2026-05-06] 6.1 / 6.2 / 6.3 — Storage layer.**
  - `src/lib/files/paths.ts`: `normalizeVaultPath` (запрещает `..`, абсолютные пути, NUL, `.`, `.versions`, конвертирует `\` → `/`, длину сегмента ≤ 255), `resolveProjectFile` (двойная защита через `path.relative` от выхода за project root), `getProjectRoot`, `getVersionPath`.
  - `src/lib/files/hash.ts`: `sha256OfBuffer`, `sha256OfStream`, `sha256OfFile` (стриминг через `createReadStream`).
  - `src/lib/files/storage.ts`: атомарная запись (`<target>.<rand>.tmp` → `rename`), `read*Stream`, `getProjectFileStat`, `deleteProjectFile` (idempotent), `moveProjectFile`, `listProjectFiles` (рекурсивный walk, исключает `.versions`), `hashProjectFile`, `writeVersionSnapshot`, `readVersionSnapshotStream`.
  - `src/lib/files/versioning.ts`: `recordFileVersion` — пропускает создание если хеш совпадает с предыдущей версией; иначе пишет snapshot и `FileVersion` row.

- **[2026-05-06] e2e isolation.**
  - `playwright.config.ts` → `webServer.env.STORAGE_PATH = './storage-e2e'` чтобы Next dev писал не в основной `./storage`.
  - `resetE2eDatabase()` теперь дополнительно `rm -rf storage-e2e` перед каждым тестом.
  - Добавлено в `.gitignore`.

- **[2026-05-06] Этап 5 ЗАВЕРШЁН.** Управление проектами и участниками. Все проверки чисты:
  - `format:check` / `typecheck` / `lint` — 0 проблем.
  - `pnpm test` — **25/25** unit (+11 на permissions × 5 + slugify × 4 и др.).
  - `pnpm test:integration` — **29/29** (без новых; покрытие через e2e).
  - `pnpm test:e2e` — **11/11** (+3 в `projects-flow.spec.ts`: полный owner→invite→accept→permissions→delete flow, share-link, email-mismatch).

- **[2026-05-06] 5.6 — Тесты.**
  - `src/lib/auth/permissions.test.ts` — 5 групп: `isSuperAdmin`, `canViewProject`, `canEditFiles`, `canManageMembers`/`canEditProjectMetadata`, `canDeleteProject`. Покрыты все комбинации owner / superadmin / ADMIN / EDITOR / VIEWER / stranger.
  - `src/lib/projects/slug.test.ts` — slugify для latin, кириллица (transliteration), edge-cases (non-printable → empty, max length 60).
  - `tests/e2e/projects-flow.spec.ts` — три серьёзных flow на реальном API через `playwright.request.newContext()` (изолированные cookies для двух пользователей):
    1. owner создаёт → invite по email → invitee видит 403 пока не принял → accept → виден в списке проектов → EDITOR не может приглашать/удалять → owner удаляет.
    2. share-link (email=null) → любой залогиненный пользователь принимает → роль VIEWER присваивается.
    3. email-bound invite + чужой аккаунт → 400 `invite_email_mismatch`.

- **[2026-05-06] 5.5 — UI.**
  - `/dashboard` — заменил заглушку на список проектов (карточки 1–3 в строке) + диалог создания (имя/описание/эмодзи).
  - `/projects/[id]` — обзор: иконка, название, описание, slug, счётчики участников и файлов; кнопка «Настройки» только для ADMIN.
  - `/projects/[id]/settings` — четыре карточки: метаданные (name/description/iconEmoji, PATCH с null для очистки), участники (таблица + смена роли + удаление, owner защищён), приглашения (email/share-link, copy, отзыв), удаление проекта (destructive + ConfirmDialog).
  - `/invite/[token]` — переписан под двойной flow: server-invite → редирект на `/register?invite=<token>`; project-invite → инфо + accept (с email-check + login-redirect если не залогинен).

- **[2026-05-06] 5.3 — Endpoints для приглашений + me.**
  - `POST /api/auth/accept-invite` — авторизация обязательна, email-check, транзакционно создаёт `ProjectMember` + помечает invitation `acceptedAt/acceptedById`. Идемпотентен: при P2002 возвращает `{ alreadyMember: true }`.
  - `GET /api/auth/invite/[token]` — публичный endpoint introspection: возвращает `{ type: 'project' | 'server', email, role, projectName? }`. Используется UI до авторизации.
  - `GET /api/auth/me` — текущий пользователь.

- **[2026-05-06] 5.2 — Endpoints приглашений в проект.**
  - `POST /api/projects/[id]/invitations` — два режима: `email` (отправляется письмо через `projectInvitationMessage`) или `shareLink: true` (возвращает URL `${PUBLIC_URL}/invite/<token>`). Token = 32 random hex bytes, TTL 14 дней.
  - `GET` — активные (не accepted) для ADMIN.
  - `DELETE /api/projects/[id]/invitations/[token]` — отзыв.

- **[2026-05-06] 5.1 — Endpoints проектов.**
  - `GET /api/projects` — мои + те, где я участник; `_count.members` и `_count.files` агрегаты.
  - `POST /api/projects` — slug автогенерируется (`generateUniqueSlug`), создатель транзакционно становится `ProjectMember` с ролью ADMIN.
  - `GET /api/projects/[id]` — данные + `role` пользователя.
  - `PATCH /api/projects/[id]` — обновление метаданных (nullable description/iconEmoji).
  - `DELETE /api/projects/[id]` — каскадное удаление (только владелец/SUPERADMIN).
  - `GET/POST /api/projects/[id]/members`, `PATCH/DELETE .../[memberId]` — управление участниками. Защита роли владельца от изменения и удаления (`owner_role_immutable` / `owner_immutable`).

- **[2026-05-06] 5.4 — `src/lib/auth/permissions.ts` + `src/lib/projects/slug.ts`.**
  - `loadProjectAccess(user, projectId)` — единая загрузка `{ project, membership }`.
  - Чистые функции прав: `canViewProject` / `canEditFiles` (ADMIN+EDITOR) / `canManageMembers` (только ADMIN) / `canDeleteProject` (только owner или SUPERADMIN). SUPERADMIN всегда true.
  - `slugify` с кириллической транслитерацией. `generateUniqueSlug` с проверкой коллизий и hex-суффиксом.

- **[2026-05-06] vitest unit env.**
  - В `vitest.config.ts` (unit) добавлен `env` блок с placeholder `DATABASE_URL` + JWT-секреты — чтобы модули, eagerly инстанцирующие PrismaClient при import, не падали в unit-тестах. Сама БД в unit-тестах не используется (только инстанцирование клиента).

- **[2026-05-06] Этап 4 ЗАВЕРШЁН.** API-ключи. Все проверки чисты:
  - `format:check` / `typecheck` / `lint` — 0 проблем.
  - `pnpm test` — **14/14** unit (+5 на api-key.ts).
  - `pnpm test:integration` — **29/29** (+5 на api-key-middleware: valid auth, missing header, malformed token, tampered key, expired key + проверка `lastUsedAt` bump).
  - `pnpm test:e2e` — **8/8** (+1 api-keys-flow: create → copy → list → delete через UI с проверкой БД, что хеш ≠ plain и `keyPrefix` совпадает с `plain.slice(0, 12)`).

- **[2026-05-06] 4.5 — Тесты api-keys.**
  - `src/lib/auth/api-key.test.ts` — формат `osync_<64hex>`, уникальность, prefix=12, verifyApiKey roundtrip, isWellFormedApiKey accept/reject (lowercase only).
  - `tests/integration/auth/api-key-middleware.test.ts` — реальная БД через `testPrisma`, проверка всех веток `authenticateApiKey`.
  - `tests/e2e/api-keys-flow.spec.ts` — UI flow: пустое состояние, создание, диалог "ключ показан один раз", появление в таблице, удаление с confirm.

- **[2026-05-06] 4.4 — UI `/api-keys`.**
  - Заменил заглушку на полнофункциональный список: shadcn `Table` с колонками (название, prefix, использован, создан, истекает), кнопка удаления.
  - Диалог создания: ввод имени, POST, диалог "ключ создан" с copy-to-clipboard кнопкой и предупреждением «больше не покажется» (красный текст в `DialogDescription`).
  - Подтверждение удаления через `ConfirmDialog`. Toast'ы (`sonner`) на успех/ошибку.
  - Пустое состояние через `EmptyState`. Локализация через `useTranslations('apiKeys')` (новый раздел в `ru.json`).
  - **Замечание (lint):** правило `react-hooks/set-state-in-effect` в Next 16 жёсткое — для пары паттернов `useEffect → setState` (initial fetch при mount, reset формы при open диалога) пришлось: (1) условно mount-ить `CreateKeyDialog` через `{createOpen && <... />}` чтобы state создавался заново; (2) на верх `api-keys/page.tsx` добавить `/* eslint-disable react-hooks/set-state-in-effect */` (одна локальная директива не работала корректно). Будет переделано на server component с initial data на финальном этапе.

- **[2026-05-06] 4.2 — API-роуты `/api/api-keys`.**
  - `GET /api/api-keys` — список ключей текущего пользователя (без хеша/полного значения, только prefix).
  - `POST /api/api-keys` — создание (name + optional `expiresAt` ISO). Возвращает полный `plain` **один раз** в payload.
  - `DELETE /api/api-keys/[id]` — отзыв ключа (через `deleteMany` для атомарности owner-check + delete).
  - Все три требуют сессии (`getCurrentUser()`) и возвращают единый формат ошибок.

- **[2026-05-06] 4.3 — `src/lib/auth/api-key-middleware.ts`.**
  - `authenticateApiKey(request)` читает заголовок `x-api-key`, валидирует формат (`isWellFormedApiKey`), ищет в БД по `keyPrefix` (с фильтром `expiresAt IS NULL OR > NOW()`), для каждого кандидата делает `bcrypt.compare`. На успех — обновляет `lastUsedAt` и возвращает `{ user, apiKeyId }`.

- **[2026-05-06] 4.1 — `src/lib/auth/api-key.ts`.**
  - `generateApiKey()` → `{ plain: 'osync_<random32hex>', hash: bcrypt(plain, 12), prefix: первые 12 символов }`.
  - `verifyApiKey(plain, hash)` — bcrypt compare.
  - `isWellFormedApiKey(plain)` — regex `^osync_[0-9a-f]{64}$`.
  - **Архитектурный выбор:** хеш — bcrypt (по `tasks.md`), что не позволяет искать ключ по hash. Поэтому хранится `keyPrefix` (12 символов, ≈16M комбинаций — коллизии практически отсутствуют), используется как индекс при аутентификации. На каждый совпадающий префикс — bcrypt.compare. Альтернатива (sha256) была бы быстрее, но менее устойчива при утечке БД.

- **[2026-05-06] Этап 3 ЗАВЕРШЁН.** Личный кабинет и базовый UI. Все проверки чисты:
  - `pnpm format:check` / `typecheck` / `lint` — 0 проблем.
  - `pnpm test` — **9/9** unit. `test:integration` — **24/24**. `test:e2e` — **7/7** (3 auth-flow + 1 smoke + 3 UI-flow).

- **[2026-05-06] Auth fix — access cookie.**
  - `login` и `refresh` теперь дополнительно ставят `osync_access` (httpOnly, secure в проде, SameSite=Lax, TTL 15m), `logout`/`refresh-failure` — чистят. Это нужно для `proxy.ts` и server-side `getCurrentUser()` на защищённых страницах.

- **[2026-05-06] 3.7 — Кастомный `zodResolver` для react-hook-form.**
  - `@hookform/resolvers/zod@5.2.2` имеет фрагильную типизацию против zod v4. `standardSchemaResolver` подключился, но не пробрасывал ошибки в `formState.errors` для наших схем.
  - Реализовал минимальный собственный `src/lib/forms/zod-resolver.ts` (~20 строк) поверх `safeParseAsync`. Используется во всех auth-формах. Сообщения и `aria-invalid` отображаются корректно.

- **[2026-05-06] 3.6 — Toaster (sonner) подключён в RootLayout** (`<Toaster richColors position="top-right" />`).

- **[2026-05-06] 3.4 — App-страницы.**
  - `/dashboard` — заголовок «Мои проекты» + EmptyState с кнопкой создания (контент будет на Этапе 5).
  - `/profile` — текущий пользователь (имя, email, язык). Редактирование — TODO (Этап 10 — админка).
  - `/api-keys`, `/notifications` — заглушки (EmptyState + строка «Раздел появится позже»). Полные реализации — Этапы 4 и 5.

- **[2026-05-06] 3.3 — Публичные страницы.**
  - `/login`, `/register`, `/forgot-password`, `/reset-password/[token]`, `/verify-email/[token]`, `/invite/[token]`. Все — `'use client'`, формы на `react-hook-form` + локальный `zodResolver`, `Card` от shadcn, локализация через `useTranslations('auth.*')`.
  - `/login` и `/register` обёрнуты в `<Suspense>` — `useSearchParams()` требует suspense boundary при статическом prerender.
  - `/invite/[token]` пока редиректит на `/register?invite=<token>` (для server-invitation flow). Project-invitation accept будет на Этапе 5.
  - Авто-распознавание ошибок API: код `email_taken` → нужное сообщение, `403` → «Регистрация закрыта», `validation_error.fields` → проброс в `setError` по полям.

- **[2026-05-06] 3.1 — Layouts + Auth flow.**
  - `app/layout.tsx` (root): `NextIntlClientProvider` + `<Toaster />`, шрифты Geist (latin + cyrillic).
  - `app/(public)/layout.tsx` — центрированная карточка.
  - `app/(app)/layout.tsx` — server component, через `getCurrentUser()` достаёт пользователя из cookie, `redirect('/login')` если не авторизован, оборачивает в `<AuthProvider initialUser={...}>`. Header + Sidebar + main.
  - `app/(admin)/layout.tsx` — то же + `redirect('/dashboard')` если `role !== 'SUPERADMIN'`. (Содержимое — Этап 10.)
  - `app/page.tsx` — server-side redirect на `/dashboard` или `/login`.

- **[2026-05-06] 3.5 — UI-компоненты.**
  - `components/forms/FormField` — generic-обёртка над `<Controller>` из `react-hook-form` + label/description/error из `formState.errors`. `aria-invalid` пробрасывается в Input.
  - `components/forms/FormError` — alert-блок для top-level ошибки формы.
  - `components/common/EmptyState`, `components/common/ConfirmDialog` (на shadcn `Dialog`).
  - `components/auth/AuthProvider` — React context с `user`, `setUser`, `logout()` (вызывает API + redirect).
  - `components/layout/AppHeader` — логотип + dropdown меню (профиль / api-keys / [админка для SUPERADMIN] / выход).
  - `components/layout/Sidebar` — навигация (Проекты, Профиль, API-ключи, Уведомления). Скрыт на мобилке (`md:block`).
  - `lib/api/client.ts` — fetch-обёртка `apiPost` / `apiGet` с `credentials: 'include'` и `ApiError` классом.

- **[2026-05-06] 3.2 — next-intl.**
  - `next-intl@4.11.0` + `next.config.ts` обёрнут в `createNextIntlPlugin('./src/lib/i18n/request.ts')`.
  - `src/messages/ru.json` — все строки (common, nav, auth.{login,register,forgotPassword,resetPassword,verifyEmail,invite}, dashboard, profile, apiKeys, notifications, validation, errors).
  - Один язык (`ru`) — без middleware-based локализации в URL, но архитектура готова к добавлению других через `SUPPORTED_LOCALES`.

- **[2026-05-06] Этап 2 ЗАВЕРШЁН.** Аутентификация и сессии. Все проверки чисты:
  - `pnpm typecheck` / `pnpm lint` / `pnpm format:check` — 0 проблем.
  - `pnpm test` — **9/9** unit (jwt sign/verify roundtrip, password hash/verify, sanity, dom).
  - `pnpm test:integration` — **24/24** (10 schema + 14 auth API: register × 6, verify-email × 3, password-reset × 5).
  - `pnpm test:e2e` — **4/4** (smoke + полный flow `register → verify → login → refresh-rotate → logout → refresh denied` + closed-registration + wrong-password).

- **[2026-05-06] 2.10 — Playwright e2e auth-flow.**
  - `playwright.config.ts` → `webServer.env` переопределяет `DATABASE_URL` на test-БД и задаёт JWT-секреты — реальный Next.js dev запускается изолированно от dev-данных.
  - `tests/e2e/helpers/db.ts` — отдельный Prisma-клиент для setup/teardown в e2e (в обход HMR-singleton'а сервера).
  - `tests/e2e/auth-flow.spec.ts` — 3 теста (полный flow + 2 негативных). Использует `request` fixture (HTTP API без UI, т.к. формы — Этап 3).
  - **Замечание:** в первой итерации тест ловил «новый accessToken == старому» — JWT детерминирован при одинаковом `iat` и payload. Заменил проверку на ротацию refresh-cookie (`osync_refresh` value меняется при `/refresh`).

- **[2026-05-06] 2.9 — Vitest-тесты auth.**
  - `vitest.integration.config.ts` — `setupFiles: ['./tests/integration/setup.ts']`, env-override (`DATABASE_URL`, `JWT_*`, `NODE_ENV=test`), alias `@`. `vi.mock('@/lib/email')` вынесен в `setup.ts` (vi.mock внутри re-imported helper не применяется глобально — это особенность hoisting).
  - `tests/integration/auth/register.test.ts` — open vs closed registration, valid/invalid invite, weak password, duplicate email, mocked email verification.
  - `tests/integration/auth/verify-email.test.ts` — успех/expired/unknown.
  - `tests/integration/auth/password-reset.test.ts` — forgot (existing/missing user), reset (success, used, expired), revoke refresh tokens.
  - **Не покрыто vitest:** login/refresh/logout — требуют `cookies()` async-context из `next/headers`, который не работает при прямом вызове route-handler из тестов. Полностью покрыто Playwright-тестом (см. 2.10).

- **[2026-05-06] 2.7 — `src/proxy.ts` (бывший middleware).**
  - **Next.js 16 BREAKING:** `middleware.ts` переименован в `proxy.ts`. Дефолтный или named-export функции `proxy(request)`. Edge runtime по умолчанию.
  - Защищает: `/dashboard`, `/profile`, `/api-keys`, `/notifications`, `/projects/*`, `/admin/*`. Для `/admin/*` — дополнительно требуется `role: SUPERADMIN`.
  - Не блокирует API-роуты (`/api/*`), статику и публичные страницы — они защищаются на уровне route-handler через `getCurrentUser()` или сами публичные.
  - Token читается из cookie `osync_access` ИЛИ из `Authorization: Bearer ...`. Verify через jose в edge-режиме.

- **[2026-05-06] 2.5 / 2.6 — API роуты `/api/auth/*` + единый формат ошибок.**
  - 7 endpoint'ов: `register`, `login`, `refresh`, `logout`, `verify-email`, `forgot-password`, `reset-password`. Все — `POST`, named export, валидируются Zod-схемами из `src/lib/auth/schemas.ts`.
  - Единый формат ошибок: `{ error: { code, message, fields? } }` (`src/lib/http/errors.ts`).
  - `register` — поддерживает open registration (через `ServerConfig.openRegistration`) и invite-only (через `ServerInvitation` с проверкой email). Создаёт `EmailVerificationToken` (24h TTL), отправляет письмо.
  - `login` — bcrypt verify, выдаёт access + refresh, refresh кладёт в `httpOnly secure SameSite=Lax cookie`.
  - `refresh` — sha256(jti) → искать в `RefreshToken`, проверка expired/revoked, **revoke + issue new pair (rotation)**.
  - `logout` — revoke refresh, очистить cookie.
  - `verify-email` — User.emailVerified = now, удалить токен.
  - `forgot-password` — создать `PasswordResetToken` (1h), отправить письмо. **Всегда 200 — не раскрываем существование email.**
  - `reset-password` — обновить пароль, отметить токен `usedAt`, **отозвать ВСЕ refresh-токены пользователя** (force re-login).

- **[2026-05-06] 2.8 — `src/lib/email/`.**
  - `transport.ts` — `getMailTransport()` возвращает `SmtpTransport` (если `SMTP_HOST` задан) или `FileTransport` (пишет в `${LOG_DIR}/emails.log` + `console.log`). Cached singleton.
  - `templates.ts` — 4 шаблона (verifyEmail, passwordReset, projectInvitation, serverInvitation), HTML + text, ссылки через `PUBLIC_URL`, escapeHtml для безопасности.
  - `index.ts` — `sendMail(message)` фасад.

- **[2026-05-06] 2.4 — `src/lib/auth/session.ts`.**
  - `getCurrentUser()` — асинхронный (читает `cookies()` / `headers()` через `next/headers`), верифицирует access JWT, возвращает `SessionUser | null`.
  - `getCurrentSessionUserId()` — облегчённая версия, без обращения к БД.
  - `setRefreshCookie` / `clearRefreshCookie` / `readRefreshCookie` вынесены в `src/lib/auth/cookies.ts` (потому что они изменяют request-bound state).

- **[2026-05-06] 2.3 — `src/lib/auth/jwt.ts` + `jwt-verify.ts`.**
  - **HS256** через `jose`. Access TTL `15m`, Refresh TTL `30d` (читаются из env).
  - **Refresh-rotation схема:** в JWT кладём random `jti` (uuid), в БД — `sha256(jti)` как `tokenHash`. При `/refresh` — ищем по `sha256(jti)`, ревокаем, выдаём новую пару. SHA-256 быстрее bcrypt и достаточно для коротко-живущих токенов с принудительной ротацией.
  - **Разделение модулей:** `jwt-verify.ts` — pure jose (edge-safe, для proxy.ts), `jwt.ts` — node-only (`randomUUID`, `createHash` из `node:crypto`).

- **[2026-05-06] 2.2 — `src/lib/auth/password.ts`.** bcryptjs, 12 salt rounds.

- **[2026-05-06] 2.1 — Зависимости Этапа 2.**
  - Установлены: `jose@6.2.3`, `zod@4.4.3`, `react-hook-form@7.75.0`, `@hookform/resolvers@5.2.2`, `nodemailer@8.0.7`, `@types/nodemailer@8.0.0`, `supertest@7.2.2`, `@types/supertest@7.2.0`.
  - **Замечание:** `zod@4` — мажорное обновление от v3, но используемый API (`z.object`, `z.string`, `safeParse`) совместим. `nodemailer@8` — стабильная.

- **[2026-05-06] Этап 1 ЗАВЕРШЁН.** БД и Prisma-схема готовы. Все проверки чисты:
  - `pnpm exec prisma validate` — schema valid 🚀
  - `pnpm typecheck` — 0 ошибок
  - `pnpm lint` — 0 warning'ов
  - `pnpm test` — 3/3 unit
  - `pnpm test:integration` — **10/10** integration (новые тесты схемы)

- **[2026-05-06] 1.8 — Интеграционные тесты схемы.**
  - Создана отдельная БД `obsidian_sync_test`, миграции применены через `DATABASE_URL=...test pnpm exec prisma migrate deploy`.
  - `vitest.integration.config.ts` (environment `node`, `fileParallelism: false`, timeout 30s).
  - `tests/integration/db.ts` — собственный `testPrisma` (PrismaPg adapter) + `resetDatabase()` через `TRUNCATE TABLE ... RESTART IDENTITY CASCADE` в правильном порядке таблиц.
  - `tests/integration/schema.test.ts` — 10 тестов:
    - `User`: создание с дефолтами, unique email, cascade на токены/api-keys.
    - `Project`: Restrict при удалении владельца, unique `(projectId, userId)`, cascade members/invitations/files/operations.
    - `VaultFile`: cascade на YjsDocument/FileVersion, unique `(projectId, path)`, SetNull для FileVersion.author.
    - `ServerConfig`: key + JSON value.
  - Скрипты: `test:integration`, `test:all`.

- **[2026-05-06] 1.7 — `src/lib/db/client.ts` — singleton Prisma client.**
  - Использует driver adapter `PrismaPg` (Prisma 7 требует adapter для рантайма).
  - Глобальный кэш через `globalThis` для HMR-защиты в dev.
  - log: `['warn', 'error']` в dev, `['error']` в prod.

- **[2026-05-06] 1.5 / 1.6 — `prisma/seed.ts` + `db:seed`.**
  - Seed создаёт/обновляет суперадмина (`ADMIN_EMAIL` / `ADMIN_PASSWORD`, bcrypt rounds=12) и три записи `ServerConfig` (`openRegistration`, `smtpEnabled`, `defaultUserRole`).
  - В `package.json`: `prisma.seed = "tsx prisma/seed.ts"` (Prisma seed-хук) + script `"db:seed"`.
  - Локально проверено: суперадмин `admin@localhost` создан с ролью `SUPERADMIN`, `emailVerified` выставлен.
  - Также добавлены scripts: `db:migrate`, `db:migrate:deploy`, `db:generate`, `db:studio`, `db:reset`.

- **[2026-05-06] 1.2 / 1.3 / 1.4 — Schema + миграция init.**
  - `prisma/schema.prisma`: 16 моделей (User, EmailVerificationToken, PasswordResetToken, RefreshToken, ApiKey, Project, ProjectMember, ProjectInvitation, ServerInvitation, VaultFile, YjsDocument, FileVersion, OperationLog, AuditLog, ServerConfig) + 4 enum (UserRole, ProjectRole, FileType, OpType).
  - id — `cuid()`. `BigInt` для `VaultFile.size`. `Bytes` для `YjsDocument.state`. `Json` для `OperationLog.vectorClock/payload`, `AuditLog.metadata`, `ServerConfig.value`.
  - Cascading: User → токены/api-keys (Cascade); User-owner → Project (Restrict); User → ProjectMember (Cascade), ProjectMember.addedBy (SetNull); Project → members/invitations/files/operations (Cascade); VaultFile → YjsDocument/FileVersion (Cascade); FileVersion.author / OperationLog.author / VaultFile.lastModifiedBy / AuditLog.user — SetNull.
  - Индексы: email, userId, projectId, contentHash, `(projectId, createdAt)` для OperationLog, `(entityType, entityId)` для AuditLog, и др.
  - Уникальные: `User.email`, `Project.slug`, `(ProjectMember.projectId, userId)`, `(VaultFile.projectId, path)`, `(FileVersion.fileId, versionNumber)`.
  - Миграция: `prisma\migrations\20260506065921_init\migration.sql` применена на dev и test БД.

- **[2026-05-06] 1.1 — Prisma 7.8.0 установлен.**
  - **BREAKING CHANGE Prisma 7:** `datasource { url = env(...) }` больше не разрешён в `schema.prisma`. URL теперь в `prisma.config.ts` (`datasource.url`). Driver adapter (`@prisma/adapter-pg`) обязателен для PrismaClient в рантайме. См. `https://pris.ly/d/prisma7-client-config`.
  - `prisma.config.ts`: `dotenv/config` + `defineConfig({ schema, datasource.url })`. _Заметка по типам:_ в `@prisma/config@7.8.0` тип `MigrationsConfigShape` ещё не содержит `adapter`, поэтому adapter передаётся только в PrismaClient в коде, а миграции работают через `datasource.url`.
  - Установлены: `prisma@7.8.0`, `@prisma/client@7.8.0`, `@prisma/adapter-pg@7.8.0`, `pg@8.20.0`, `bcryptjs@3.0.3`, `tsx@4.21.0`, `dotenv@17.4.2`. Также `pnpm.onlyBuiltDependencies` в package.json — `@prisma/engines`, `@prisma/client`, `prisma`, `esbuild`.
  - **Адаптация tasks.md:** в `1.1` строка `pnpm prisma init` неактуальна (создаёт устаревший формат); используем ручное создание `prisma.config.ts` + `schema.prisma`. _Адаптирую tasks.md ниже отдельным шагом, если потребуется._

- **[2026-05-06] БД для разработки/тестов.**
  - Создана роль `obsidian` (LOGIN, CREATEDB, password=`obsidian`) и БД `obsidian_sync_dev`, `obsidian_sync_test` (owner=obsidian).
  - Подключение проверено: `psql -h localhost -U obsidian -d obsidian_sync_dev`.
  - В `.env` для dev — `DATABASE_URL=postgresql://obsidian:obsidian@localhost:5432/obsidian_sync_dev`. Тесты используют `TEST_DATABASE_URL` (default `obsidian_sync_test`).

- **[2026-05-06] PostgreSQL 16.13 установлен и проверен.**
  - Установлен в `C:\Program Files\PostgreSQL\16\` (бинарник, сервис, addr default: `localhost:5432`).
  - Сервис Windows: `postgresql-x64-16` — Running, StartType Automatic.
  - Системный PATH: `C:\Program Files\PostgreSQL\16\bin` уже добавлен установщиком (для новых терминальных сессий `psql` доступен напрямую).
  - Подключение проверено: `PGPASSWORD=obsidian psql -h localhost -U postgres -c "SELECT version();"` → `PostgreSQL 16.13`.
  - **Важно:** в `.env.example` указан пользователь `obsidian` и БД `obsidian_sync_dev` — этих сущностей пока нет, создадутся на Этапе 1.5 (Prisma seed / отдельный скрипт инициализации БД для разработки).

- **[2026-05-06] Корректировки после ревью Этапа 0:**
  - **Версия Next.js.** `tasks.md` (стек + 0.1) и корневой `README.md` обновлены с «Next.js 15» на «Next.js 16» под фактически установленный `16.2.4`. В команду 0.1 добавлен флаг `--turbopack`. В стек добавлено «Tailwind CSS v4».
  - **shadcn переинициализирован в классическом стиле.** Удалены старые артефакты (`components.json`, `src/components/ui/*`, `src/lib/utils.ts`, deps `@base-ui/react`, `tw-animate-css`, `shadcn` (как dep)). Запущено `npx shadcn@latest init --yes --base radix --preset nova --force`. Текущий стиль — `radix-nova` (база на `radix-ui`, не `@base-ui/react`). Добавлены компоненты: `button`, `input`, `dialog`, `table`, `dropdown-menu`, `sonner`, `label`, `card`. **Подтверждено:** в shadcn ≥ 4.x компонент `form` (обёртка Form/FormField над react-hook-form) больше не поставляется ни в одном из стилей — `npx shadcn add form --view` выдаёт «No files». На этапе 3.7 формы будут на чистом `react-hook-form`; tasks.md 3.6 / 3.7 / 0.8 адаптированы соответствующим образом.
  - Поправлены `sonner.tsx` (theme через `?? 'system'`) и `dropdown-menu.tsx` (условный spread `checked`) под `exactOptionalPropertyTypes: true`. Все проверки (`format`, `typecheck`, `lint`, `test`) — чистые.
  - **PostgreSQL через Chocolatey не установился** — `choco install postgresql16` упал на правах доступа к `C:\ProgramData\chocolatey\lib-bad` (нужен запуск от администратора). Пакет загружен (`postgresql16 16.13.0`), но установка не прошла. Требуется повторный запуск пользователем из PowerShell (Run as Administrator): `choco install postgresql16 -y --params "/Password:obsidian"`.

- **[2026-05-06] Этап 0 ЗАВЕРШЁН.** Все 11 пунктов выполнены. Финальные проверки проходят чисто:
  - `pnpm typecheck` — 0 ошибок
  - `pnpm lint` — 0 ошибок/warning'ов
  - `pnpm format:check` — все файлы по стилю
  - `pnpm test` — 3/3 unit-теста (Vitest)
  - `pnpm test:e2e` — 1/1 e2e (Playwright + chromium)
  - **Готов к Этапу 1 (Prisma + БД).** Перед стартом нужно установить PostgreSQL ≥ 15 локально.

- **[2026-05-06] 0.11 — `LICENSE` (MIT, Copyright 2026 Obsidian Sync Contributors) и `README.md`-заглушка с описанием стека, команд и структуры. Полная документация — на Этапе 14.**

- **[2026-05-06] 0.10 — Vitest 4.1.5 + Playwright 1.59.1 настроены.**
  - `vitest.config.ts` (jsdom, globals, setup-файл, coverage v8, нативный `tsconfigPaths`).
  - `tests/setup.ts` (cleanup из `@testing-library/react`, `@testing-library/jest-dom/vitest`).
  - Примеры тестов: `tests/unit/sanity.test.ts`, `tests/unit/dom.test.tsx`.
  - `playwright.config.ts` (chromium, webServer запускает `pnpm dev`, baseURL=localhost:3000).
  - `tests/e2e/smoke.spec.ts` — проверка 200 на `/`.
  - Установлены пакеты: `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `@playwright/test`. Браузер chromium загружен через `playwright install chromium`.
  - Скрипты: `test`, `test:watch`, `test:coverage`, `test:e2e`, `test:e2e:ui`.

- **[2026-05-06] 0.9 — `lucide-react@1.14.0` установлен автоматически через `shadcn init` (используется как `iconLibrary` в `components.json`).**

- **[2026-05-06] 0.8 — `shadcn/ui` инициализирован.**
  - Команда: `npx shadcn@latest init --yes --defaults --force`.
  - Стиль: `base-nova` (новый вариант на `@base-ui/react` вместо `radix-ui`). `baseColor: neutral`, CSS variables.
  - Добавлены компоненты: `button`, `input`, `dialog`, `table`, `dropdown-menu`, `sonner` (вместо `toast`), `label`, `card`, `field` (в `base-nova` заменяет `form`), `separator`.
  - **Несоответствие с `tasks.md`:** в задаче 3.7 упоминаются `Form`/`FormField` из shadcn — в стиле `base-nova` их нет, есть `field`. На Этапе 3 решим: либо переинициализировать с классическим стилем, либо адаптировать с `react-hook-form` напрямую через `field`.
  - Установлены деп-зависимости: `@base-ui/react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `next-themes`, `sonner`, `tw-animate-css`.
  - Поправлен `src/components/ui/sonner.tsx` под `exactOptionalPropertyTypes: true` (использован `??` вместо деструктур-дефолта).

- **[2026-05-06] 0.7 — Создан `.env.example` со всеми переменными из `tasks.md` (DATABASE*URL, JWT*_, PORT*WEB/PORT_SOCKET, PUBLIC_URL, STORAGE_PATH, OPEN_REGISTRATION, SMTP*_, LOG*\*, ADMIN*\*, NODE_ENV). В `.gitignore` добавлено исключение `!.env.example`, а также `/storage`, `/logs`, `/dist`, артефакты Playwright. Все секреты — placeholder'ы.**

- **[2026-05-06] 0.6 — Создана структура папок согласно `tasks.md`:** `src/app/{(public),(app),(admin),api}`, `src/components/ui`, `src/lib/{auth,db,files,crdt,sync,email,logger,i18n}`, `src/socket/handlers`, `src/messages`, `prisma`, `scripts`, `config`, `tests/{unit,e2e}`. Пустые папки помечены `.gitkeep`.

- **[2026-05-06] 0.5 — Commitlint (Conventional Commits) настроен.**
  - `@commitlint/cli@20.5.3`, `@commitlint/config-conventional@20.5.3` установлены.
  - `commitlint.config.mjs` — extends `config-conventional`.
  - `.husky/commit-msg` — `pnpm exec commitlint --edit "$1"`.
  - Проверено: невалидные сообщения отвергаются, валидные пропускаются.

- **[2026-05-06] 0.4 — Husky 9.1.7 + lint-staged 16.4.0.**
  - `package.json` → `prepare: husky` (активируется при `pnpm install` после `git init`).
  - `lint-staged` секция: `*.{ts,tsx,js,jsx,mjs,cjs}` → eslint + prettier; `*.{json,md,yml,yaml,css}` → prettier.
  - `.husky/pre-commit` — `pnpm exec lint-staged`.

- **[2026-05-06] 0.3 — Prettier 3.8.3 + `prettier-plugin-tailwindcss` 0.8.0.**
  - `.prettierrc` (single quotes, trailing commas all, printWidth 100, tab width 2).
  - `.prettierignore` (node_modules, .next, build, lockfiles, public, .env\*, storage и т.д.).
  - Скрипты `format` / `format:check`.
  - Прогон `pnpm format` отформатировал все файлы проекта.

- **[2026-05-06] 0.2 — `tsconfig.json` ужесточён.**
  - Включено: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`.
  - `target` поднят до `ES2022` (Node 20+).
  - `tsc --noEmit` проходит чисто.

- **[2026-05-06] 0.1 — Создан Next.js проект в `server/`.**
  - Команда: `npx create-next-app@latest server --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --turbopack --yes`.
  - Установлены: `next@16.2.4`, `react@19.2.4`, `eslint@9.39.4`, `tailwindcss@4.2.4`, `typescript@5.9.3`.
  - **Замечание:** в `tasks.md` указан Next.js 15, но `@latest` поставил 16.2.4 (актуальный релиз на дату). Продолжаю на 16 — обратно совместим, App Router/RSC те же. Tailwind 4 (CSS-first вместо `tailwind.config.js`).
  - **Замечание:** `create-next-app` автоматически сделал `git init` — удалено по требованию пользователя (репозитории привяжем позже).
  - **Замечание:** в `AGENTS.md` от шаблона написано «This is NOT the Next.js you know» — перед написанием специфичного кода читать `node_modules/next/dist/docs/`.
  - Существующие файлы (`.mcp.json`, `tasks.md`) сохранены через временный backup и возвращены.

- **[2026-05-06] env — Установлен pnpm глобально (10.33.3). Node v24.15.0, git 2.47.1. PostgreSQL пока не установлен — потребуется на Этапе 1.**
