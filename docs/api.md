# REST API & Socket.IO события

Все REST-эндпоинты возвращают JSON. Ошибки — единым форматом:

```json
{
  "error": {
    "code": "validation_error",
    "message": "...",
    "fields": { "email": ["Некорректный email"] }
  }
}
```

Поле `fields` присутствует только для `validation_error`.

## Аутентификация

Поддерживаются два способа:

- **Session cookies** (`osync_access` + `osync_refresh`) — выставляются `/api/auth/login` и `/api/auth/refresh`.
- **API key** — заголовок `X-API-Key: osync_<64hex>`.

Защищённые роуты используют функцию `authenticateRequest` — пытается API-key, затем session.

## REST API

### Auth

| Метод | Путь                        | Описание                                                                                                                                                |
| ----- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST  | `/api/auth/register`        | Регистрация. `{ email, password, name, inviteToken? }`. Открыта только если `ServerConfig.openRegistration=true` или предъявлен валидный `inviteToken`. |
| POST  | `/api/auth/login`           | `{ email, password }` → `{ accessToken, user }` + cookies.                                                                                              |
| POST  | `/api/auth/refresh`         | Без тела (читает refresh из cookie). Ротирует пару. → `{ accessToken }`.                                                                                |
| POST  | `/api/auth/logout`          | Отзывает refresh, чистит cookies.                                                                                                                       |
| POST  | `/api/auth/verify-email`    | `{ token }` → `User.emailVerified = now`.                                                                                                               |
| POST  | `/api/auth/forgot-password` | `{ email }`. **Всегда 200**, чтобы не раскрывать существование email.                                                                                   |
| POST  | `/api/auth/reset-password`  | `{ token, password }`. Также revoke всех refresh-токенов пользователя.                                                                                  |
| POST  | `/api/auth/accept-invite`   | `{ token }` для project-invitation; требует логина.                                                                                                     |
| GET   | `/api/auth/invite/[token]`  | Публичный endpoint introspection: `{ type: 'server' \| 'project', email, role?, projectName? }`.                                                        |
| GET   | `/api/auth/me`              | Текущий пользователь.                                                                                                                                   |

### API keys

| Метод  | Путь                 | Описание                                                                                              |
| ------ | -------------------- | ----------------------------------------------------------------------------------------------------- |
| GET    | `/api/api-keys`      | Список ключей текущего пользователя (без полных значений, только prefix).                             |
| POST   | `/api/api-keys`      | `{ name, expiresAt? }` → `{ key: { id, plain, keyPrefix, ... } }`. **`plain` показывается один раз.** |
| DELETE | `/api/api-keys/[id]` | Отозвать ключ.                                                                                        |

### Проекты

| Метод  | Путь                 | Описание                                                                         |
| ------ | -------------------- | -------------------------------------------------------------------------------- |
| GET    | `/api/projects`      | Мои проекты + те, где я участник.                                                |
| POST   | `/api/projects`      | `{ name, description?, iconEmoji? }` → создатель = ADMIN. Slug автогенерируется. |
| GET    | `/api/projects/[id]` | Данные проекта + `role` пользователя.                                            |
| PATCH  | `/api/projects/[id]` | `{ name?, description?, iconEmoji? }` (ADMIN/owner).                             |
| DELETE | `/api/projects/[id]` | Каскадное удаление (только владелец/SUPERADMIN).                                 |

### Участники

| Метод  | Путь                                    | Описание                                     |
| ------ | --------------------------------------- | -------------------------------------------- |
| GET    | `/api/projects/[id]/members`            | Список участников.                           |
| POST   | `/api/projects/[id]/members`            | `{ email, role }` (ADMIN).                   |
| PATCH  | `/api/projects/[id]/members/[memberId]` | `{ role }`. Роль владельца изменить нельзя.  |
| DELETE | `/api/projects/[id]/members/[memberId]` | Удалить участника. Владельца удалить нельзя. |

### Приглашения в проект

| Метод  | Путь                                     | Описание                                                                                          |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| GET    | `/api/projects/[id]/invitations`         | Активные приглашения (ADMIN).                                                                     |
| POST   | `/api/projects/[id]/invitations`         | `{ email, role }` (отправит email) **или** `{ role, shareLink: true }` (вернёт URL). TTL 14 дней. |
| DELETE | `/api/projects/[id]/invitations/[token]` | Отозвать.                                                                                         |

### Файлы

| Метод  | Путь                                                     | Описание                                                                          |
| ------ | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| GET    | `/api/projects/[id]/files`                               | Список файлов. `?includeDeleted=true` — с soft-deleted. `size` — string (BigInt). |
| POST   | `/api/projects/[id]/files`                               | `multipart/form-data: path, file`. Создаёт `VaultFile` + первую `FileVersion`.    |
| GET    | `/api/projects/[id]/files/[fileId]`                      | Скачивание (стрим). `Content-Type` из `mimeType`.                                 |
| PUT    | `/api/projects/[id]/files/[fileId]`                      | Raw body — обновляет содержимое. Создаёт новую версию (если хеш изменился).       |
| PATCH  | `/api/projects/[id]/files/[fileId]`                      | `{ newPath }` — переименование/перемещение.                                       |
| DELETE | `/api/projects/[id]/files/[fileId]`                      | Soft delete.                                                                      |
| GET    | `/api/projects/[id]/files/[fileId]/versions`             | Список версий.                                                                    |
| GET    | `/api/projects/[id]/files/[fileId]/versions/[versionId]` | Скачивание snapshot версии. Заголовок `x-content-hash`.                           |

### Admin

Все требуют `role=SUPERADMIN`.

| Метод  | Путь                          | Описание                                                                            |
| ------ | ----------------------------- | ----------------------------------------------------------------------------------- |
| GET    | `/api/admin/users`            | `?search&page&pageSize`                                                             |
| POST   | `/api/admin/users`            | Создать пользователя                                                                |
| GET    | `/api/admin/users/[id]`       | Детали + последние 50 audit-записей                                                 |
| PATCH  | `/api/admin/users/[id]`       | `{ role?, disabled?, emailVerified?, name? }`                                       |
| DELETE | `/api/admin/users/[id]`       | Удалить (защита от self-delete)                                                     |
| GET    | `/api/admin/projects`         | Все проекты с `?search`                                                             |
| GET    | `/api/admin/invitations`      | Server-invitations                                                                  |
| POST   | `/api/admin/invitations`      | `{ email }`                                                                         |
| DELETE | `/api/admin/invitations/[id]` | Отозвать                                                                            |
| GET    | `/api/admin/settings`         | `ServerConfig` ключи `openRegistration / smtpEnabled / defaultUserRole / publicUrl` |
| PATCH  | `/api/admin/settings`         | Обновить через transactional upsert                                                 |
| GET    | `/api/admin/audit-log`        | `?userId&action&entityType&from&to&page&pageSize`                                   |

## Примеры

### Регистрация → подтверждение → вход (cURL)

```bash
# 1. Регистрация
curl -sX POST https://sync.example.com/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"StrongPass1!","name":"Alice"}'
# {"id":"...","email":"alice@example.com","name":"Alice"}

# 2. Достаём verification token (из БД или /admin)
TOKEN=$(psql ...)

# 3. Подтверждаем
curl -sX POST https://sync.example.com/api/auth/verify-email \
  -H 'content-type: application/json' \
  -d "{\"token\":\"$TOKEN\"}"

# 4. Логинимся
curl -sX POST https://sync.example.com/api/auth/login \
  -H 'content-type: application/json' \
  -c /tmp/c.jar \
  -d '{"email":"alice@example.com","password":"StrongPass1!"}' \
  | jq -r .accessToken
```

### Создание API-ключа

```bash
# Под session cookie:
curl -sX POST https://sync.example.com/api/api-keys \
  -b /tmp/c.jar \
  -H 'content-type: application/json' \
  -d '{"name":"Laptop"}'
# {"key":{"id":"...","plain":"osync_<64hex>","keyPrefix":"osync_a1b2c3","createdAt":"..."}}
```

### Загрузка файла через API-key

```bash
KEY=osync_<64hex>
curl -sX POST https://sync.example.com/api/projects/$PROJECT_ID/files \
  -H "X-API-Key: $KEY" \
  -F "path=notes/welcome.md" \
  -F "file=@./welcome.md;type=text/markdown"
# {"file":{"id":"...","path":"notes/welcome.md","contentHash":"<sha256>",...}}
```

## Socket.IO события

URL: `wss://<домен>/socket.io/`. Каддиский reverse-proxy → :3001.

Аутентификация: `socket.handshake.auth.apiKey` (или X-API-Key header).
Отказ — `connect_error` со строкой `'unauthorized'`.

### Клиент → сервер

| Событие                     | Payload                                                                                                   | Ack                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `project:join`              | `{ projectId, sinceVectorClock? }`                                                                        | `{ ok: true, operations: [...], yjsDocs: [{ fileId, sync1: number[] }] }` или `{ ok: false, error: 'forbidden' \| 'project_not_found' \| ... }` |
| `project:leave`             | `{ projectId }`                                                                                           | `{ ok: true }`                                                                                                                                  |
| `file:create`               | `{ projectId, clientId, vectorClock?, filePath, fileType, mimeType?, contentHash, size, data: number[] }` | `{ ok, outcome }`                                                                                                                               |
| `file:update-binary`        | `{ projectId, clientId, vectorClock?, fileId, contentHash, size, data: number[] }`                        | `{ ok, outcome }`                                                                                                                               |
| `file:delete`               | `{ projectId, clientId, vectorClock?, fileId, filePath }`                                                 | `{ ok, outcome }`                                                                                                                               |
| `file:rename` / `file:move` | `{ projectId, clientId, vectorClock?, fileId, filePath, newPath }`                                        | `{ ok, outcome }`                                                                                                                               |
| `yjs:update`                | `{ projectId, fileId, update: number[] }`                                                                 | `{ ok: true, changed: boolean }`                                                                                                                |

### Сервер → клиент (broadcast в room проекта)

| Событие                       | Payload                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| `file:created`                | `{ result: { outcome }, log: { id, vectorClock, createdAt } }`          |
| `file:updated-binary`         | `{ fileId, contentHash, log }`                                          |
| `file:deleted`                | `{ fileId, log }`                                                       |
| `file:renamed` / `file:moved` | `{ fileId, newPath, outcome, log }`                                     |
| `yjs:update`                  | `{ fileId, update: number[] }` (только другим клиентам, не отправителю) |

### Outcome (для `file:*`)

```ts
type ApplyOutcome =
  | { kind: 'created'; fileId: string; path: string }
  | { kind: 'updated'; fileId: string }
  | { kind: 'deleted'; fileId: string }
  | { kind: 'renamed'; fileId: string; from: string; to: string }
  | { kind: 'conflict_create_renamed'; fileId: string; originalPath: string; finalPath: string }
  | { kind: 'no_op'; reason: 'tombstone' | 'same_path' };
```

`conflict_create_renamed` — при коллизии путей файл сохранён под именем `<base>.conflict-<clientId>.<ext>`. Клиент должен отобразить пользователю и предложить ручное разрешение.

### Пример: подключение и приём updates (TypeScript)

```ts
import { io } from 'socket.io-client';

const socket = io('wss://sync.example.com', {
  auth: { apiKey: 'osync_<64hex>' },
});

socket.emit(
  'project:join',
  { projectId, sinceVectorClock: localClock },
  ({ ok, operations, yjsDocs }) => {
    if (!ok) throw new Error('Failed to join');
    operations.forEach(applyOperationLocally);
    yjsDocs.forEach(({ fileId, sync1 }) => {
      Y.applyUpdate(localDocs.get(fileId), Uint8Array.from(sync1));
    });
  },
);

socket.on('yjs:update', ({ fileId, update }) => {
  const doc = localDocs.get(fileId);
  if (doc) Y.applyUpdate(doc, Uint8Array.from(update));
});

// Локальное изменение → broadcast
localDocs.get(fileId).on('update', (update) => {
  socket.emit('yjs:update', { projectId, fileId, update: Array.from(update) });
});
```
