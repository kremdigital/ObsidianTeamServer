# Протокол синхронизации

Документ для разработчиков плагина Obsidian (или других клиентов).

Сервер — это **смесь двух механизмов**:

1. **Метаданные файлов** (создание/удаление/переименование/перемещение, бинарные апдейты) — через журнал операций (`OperationLog`) с vector clock'ом.
2. **Содержимое текстовых файлов** (`.md`) — через **Yjs CRDT**: сервер хранит binary state, клиенты обмениваются update'ами.

## Идентификаторы

- **`clientId`** — стабильный идентификатор инстанса клиента (например, UUID, сохранённый при первом запуске плагина в IndexedDB). Используется как ключ vector clock и как суффикс при разрешении конфликтов имён.
- **`fileId`** — серверный CUID файла, выдаётся при первом `CREATE`. Клиент должен запомнить mapping `vault path ↔ fileId`.
- **`projectId`** — серверный CUID проекта.

## Vector clock

Структура: `Record<clientId, number>`. Сериализуется в JSON.

```ts
type VectorClock = Record<string, number>;
```

Каждый клиент инкрементирует свой счётчик при отправке операции:

```ts
clock[myClientId] = (clock[myClientId] ?? 0) + 1;
sendOperation({ ..., vectorClock: clock });
```

При получении операции от другого клиента:

```ts
for (const [client, counter] of Object.entries(remoteClock)) {
  clock[client] = Math.max(clock[client] ?? 0, counter);
}
```

**Сравнение:**

| Соотношение  | Значение                                  |
| ------------ | ----------------------------------------- |
| `before`     | `a` строго предшествует `b`               |
| `after`      | обратно                                   |
| `equal`      | идентичны                                 |
| `concurrent` | ни одна не предшествует другой — конфликт |

## Подключение

```
WSS /socket.io/
  auth: { apiKey: "osync_<64hex>" }   // плагин / программные клиенты
  // ИЛИ (браузер / веб-редактор):
  //   - cookie `osync_access` (httpOnly) уходит автоматически при
  //     `withCredentials: true` — токен в JS читать не нужно;
  //   - либо явно auth: { token: "<JWT access>" } (fallback, напр. для тестов).
  // Сервер сначала проверяет apiKey, затем сессионный JWT. Права на действия
  // (canViewProject / canEditFiles) проверяются ниже на каждом событии:
  // VIEWER может подключиться и читать, но получит `forbidden` на запись.

→ project:join { projectId, sinceVectorClock?, streamYjs?, skipYjsCatchup? }
← ack {
    ok: true,
    operations: OperationLogRow[],   // упорядочены по createdAt asc
    // Yjs-стейт — ОДИН из двух вариантов:
    yjsDocs?: [{ fileId, sync1: number[], stateVector: number[] }]  // legacy: всё инлайн
    yjsStream?: true, yjsCount?: number                              // новый: стрим (см. ниже)
  }

// Если запрошен streamYjs: после ack сервер стримит доки батчами (по 20):
← yjs:catchup { projectId, docs: [{ fileId, sync1, stateVector }], done: boolean }
```

`sinceVectorClock` — клиент шлёт свой локальный vc. Сервер вернёт операции, чей `OperationLog.vectorClock` имеет хоть в одной координате больше, чем `since`.

`skipYjsCatchup` — клиент вступает в комнату проекта (для op-log catch-up и
live-бродкастов `yjs:update`), но Yjs-доки **не** стримятся вовсе. Ack:
`{ ok, operations, yjsSkipped: true }`. Используется **веб-редактором**: он
открывает по одной заметке и тянет нужный док точечно через `yjs:fetch` (см.
ниже), вместо catch-up всего вальта.

`streamYjs` — клиент просит **не** класть весь Yjs-стейт в ack. Иначе на большом
вальте (сотни текстовых файлов) ack раздувается: сервер грузит все Y.Doc'ы в
память (риск OOM), а клиент применяет всё синхронно и блокирует event-loop →
пропуск Socket.IO heartbeat → reconnect-ливлок. При `streamYjs: true` ack лёгкий
(`yjsStream/yjsCount`), а доки приходят батчами в событиях `yjs:catchup`: сервер
грузит БД по батчу (память ограничена), клиент обрабатывает каждый батч в
отдельном тике (event-loop уступается между сообщениями). Финальный батч —
`done: true`. Старые клиенты не шлют флаг и получают `yjsDocs` инлайн (совместимо).

После catch-up клиент **должен**:

1. Применить операции в порядке от сервера.
2. Для каждого дока (из `yjsDocs` или стримом из `yjs:catchup`) сделать
   `Y.applyUpdate(localDoc[fileId], Uint8Array.from(sync1))` — симметрично
   объединит state; `stateVector` позволяет вычислить обратную дельту (что
   сервер ещё не видел) и дослать её через `yjs:update`.

## Операции (`OperationLog`)

Каждая операция — JSON с типизированным payload:

| `opType` | payload                                                              |
| -------- | -------------------------------------------------------------------- |
| `CREATE` | `{ fileType: 'TEXT' \| 'BINARY', mimeType?, contentHash, size }`     |
| `UPDATE` | `{ fileId, contentHash, size }` (для бинарных; текст идёт через Yjs) |
| `DELETE` | `{ fileId }`                                                         |
| `RENAME` | `{ fileId }` (новый путь — в `OperationLog.newPath`)                 |
| `MOVE`   | `{ fileId }` (новый путь — в `OperationLog.newPath`)                 |

Семантика `RENAME` и `MOVE` на сервере одинакова — оба обновляют `path`. Различие — для семантики на клиенте (например, разные иконки в логе).

## Разрешение конфликтов на стороне сервера

Сервер делает резолюцию **детерминированно** в момент применения операции (`applyOperation` в `src/lib/sync/operation-log.ts`). Клиент не должен пытаться предотвратить конфликт — просто отправляет свою операцию и обрабатывает `outcome` из ack.

### CREATE-vs-CREATE на одинаковый path

Сценарий: два клиента независимо создают `notes/welcome.md`.

**Resolution:** проигравший по серверному порядку получает путь `<base>.conflict-<clientId>.<ext>`.

```
clientA → CREATE notes/welcome.md
                            ⤷ outcome: { kind: 'created', path: 'notes/welcome.md' }
clientB → CREATE notes/welcome.md     (один и тот же путь, но clientId='B')
                            ⤷ outcome: { kind: 'conflict_create_renamed',
                                          originalPath: 'notes/welcome.md',
                                          finalPath: 'notes/welcome.conflict-B.md' }
```

Клиент B при получении ack должен:

1. На стороне vault создать новый файл `notes/welcome.conflict-B.md` с содержимым своей версии.
2. Удалить локальный `notes/welcome.md` (он уже занят чужой версией).
3. Опционально: показать пользователю диалог «У вас и Алисы конфликтующие версии. Объединить?».

### DELETE > UPDATE

Сценарий: клиент A удаляет файл, клиент B одновременно обновляет.

**Resolution:** DELETE побеждает. UPDATE становится `no_op` с пометкой `suppressed: 'tombstone'` в payload `OperationLog`.

`VaultFile.deletedAt` остаётся выставленным (tombstone), `contentHash` не меняется.

Восстановление возможно — на сервере остаются `FileVersion` snapshot'ы и Yjs-state. Однако автоматический recovery пока не реализован; клиенту следует считать tombstone окончательным удалением.

### Concurrent RENAME в один target

Сценарий: A переименовывает `a.md` → `target.md`, B одновременно — `b.md` → `target.md`.

**Resolution:** второй RENAME уходит в `target.conflict-<clientId>.<ext>`. Это эквивалентно lex-сравнению clientId'ов (детерминированно).

```
clientA → RENAME a.md → target.md   ⤷ created: target.md
clientB → RENAME b.md → target.md   ⤷ conflict_create_renamed:
                                        originalPath: 'target.md',
                                        finalPath: 'target.conflict-B.md'
```

## Yjs (текстовые файлы)

### Конвенция

Каждый `Y.Doc` имеет один `Y.Text` под ключом `'content'`:

```ts
const doc = new Y.Doc();
const text = doc.getText('content');
text.insert(0, 'Hello');
```

Сервер использует **только** этот ключ для извлечения текста и записи snapshot в `.md` файл.

### Жизненный цикл

```
Plugin local edit                    Server                              Other peers
─────────────────                    ──────                              ───────────
text.insert(...)
  ⤷ doc emits 'update' event (Uint8Array)

socket.emit('yjs:update', {
  projectId, fileId,
  update: Array.from(update)
})
                              ─────► loadYjsDoc(fileId)
                                     Y.applyUpdate(doc, update)
                                     compare state vectors
                                     ⤷ changed = true
                                     upsert YjsDocument {
                                       state, stateVector
                                     }
                                     scheduleSnapshot(5s)
                              ◄───── ack { ok, changed }

                                     // 5s later, after no further edits
                                     persistTextSnapshot()
                                     ⤷ writeProjectFile(.md)
                                     ⤷ recordFileVersion (если хеш новый)

                                     ─────► broadcast 'yjs:update'
                                                                      Y.applyUpdate(localDoc, update)
                                                                      // editor reflects remote change
```

**Важно:**

- Update — **инкрементальный**. Не нужно слать весь state целиком.
- Сервер сам мержит и сам бродкастит. Клиент **не** должен ретранслировать update'ы другим peer'ам напрямую.
- `changed: false` в ack означает, что update не изменил document (например, повторная отправка). Можно безопасно игнорировать.

### Точечная загрузка одного дока (`yjs:fetch`)

Для клиентов, которым нужен лишь один документ (веб-редактор открывает заметки
по одной), есть запрос состояния одного файла без catch-up всего вальта:

```
→ yjs:fetch { projectId, fileId }
← ack { ok: true, sync1: number[], stateVector: number[] }   // как один YjsDocSnapshot
  // или { ok: false, error }  ('forbidden' | 'file_not_found' | ...)
```

Достаточно прав на **чтение** (`canViewProject`) — состояние можно загрузить,
но менять его всё равно только через `yjs:update` (там проверяется
`canEditFiles`). Если Yjs-дока ещё нет, сервер лениво сидит его из `.md` на
диске (как и при catch-up). Клиент применяет `sync1` к локальному `Y.Doc` и
дальше работает как обычно (шлёт `yjs:update`, принимает бродкасты).

> Типовой поток веб-редактора: `project:join { skipYjsCatchup: true }` →
> `yjs:fetch { fileId }` → правки идут `yjs:update`, бродкасты применяются.

### Восстановление при реконнекте

```
1. socket.connect()
2. socket.emit('project:join', { projectId, sinceVectorClock })
3. По ack:
   3.1. Применить operations[]
   3.2. Для каждого yjsDocs[i]:
        Y.applyUpdate(localDoc[fileId], Uint8Array.from(sync1));
        // Yjs CRDT гарантирует, что мерж коммутативен и идемпотентен
```

После этого локальный документ синхронизирован. Дальше клиент может слать локальные update'ы как обычно.

### Снапшоты `.md` файлов

Сервер периодически (debounced 5s) записывает извлечённый из `Y.Doc` текст в `.md` файл по пути `${STORAGE_PATH}/<projectId>/<file.path>`.

Это нужно для:

- читаемости снаружи (admin может скачать через REST);
- бэкапов FS-уровня (rsync / borgbackup в `${STORAGE_PATH}`);
- истории версий (`FileVersion` snapshot'ы создаются по тому же пути).

## Бинарные файлы

Yjs не используется. **Байты бинарных файлов НЕ передаются по сокету** — на
крупных файлах (раскадровки 10–15 MB) они пробивали `maxHttpBufferSize` и роняли
канал. Вместо этого — **staging через REST + metadata-only socket-операция**:

```
PUT /api/projects/:id/blobs/:hash   (raw body; content-addressed staging)
```

1. Клиент заливает байты в content-addressed staging: `PUT /blobs/:hash` (тело —
   сырые байты; сервер проверяет, что `sha256(body) === :hash`, и кладёт во
   `<projectRoot>/.staging/<hash>`).
2. Затем эмитит **`file:create` / `file:update-binary` БЕЗ поля `data`** (только
   метаданные + `contentHash`).
3. Сервер видит отсутствие `data`, читает staged-блоб по hash с общего диска
   (web- и socket-процессы делят storage volume), применяет операцию
   (`applyOperation` → `OperationLog` → broadcast `file:created` /
   `file:updated-binary`) и удаляет staged-файл. Если блоба нет — ack
   `{ ok:false, error:'blob_not_staged' }`, клиент повторяет.

> Текстовые файлы по-прежнему шлют контент **inline** в `file:create` (он мал и
> нужен серверу для сидирования Yjs-дока). `data` опционально: присутствует для
> TEXT, отсутствует для BINARY.

Пиры скачивают новый файл через `GET /api/projects/:id/files/:fileId`.

**CORS / транспорт плагина.** Бинарные REST-маршруты (`PUT /blobs/:hash`,
`GET /files/:fileId`, `GET …/versions/:versionId`) отдают CORS-заголовки для
origin Obsidian (`app://obsidian.md`) и заголовка `X-API-Key`, чтобы плагин мог
использовать **`fetch`** (стримит большие тела, не блокируя renderer —
в отличие от `requestUrl`, который буферизует всё тело через IPC и не тянет 15 MB).
JSON-запросы плагина остаются на `requestUrl`. Прямые `POST /files` /
`PUT /files/:fileId` сохранены для веб/админки.

## Оффлайн режим (рекомендация для плагина)

```
SQLite local journal:
  table operations(
    op_type, file_id, payload_json, vector_clock_json, status: 'pending' | 'sent' | 'acked'
  )

При локальных изменениях:
  1. Применить локально (на vault).
  2. Inkrement clock[myClientId].
  3. INSERT into operations (status='pending').
  4. Если соединение — emit и ждать ack.
     При ack — UPDATE status='acked'.

При реконнекте:
  1. project:join с sinceVectorClock = последний acked.
  2. Применить server operations.
  3. Replay локальные pending operations (могут получить outcome = 'conflict_create_renamed' — обработать).
```

## Резюме для разработчика

1. Подключайся через `socket.io-client` с `auth.apiKey`.
2. На каждом mount/unmount проекта — `project:join` / `project:leave`.
3. Для текстовых файлов — отправляй Yjs update'ы как `number[]` (Array.from Uint8Array).
4. Для метаданных — посылай `file:create / delete / rename / move` через socket.
5. Для бинарных — `PUT /blobs/:hash` (fetch), затем `file:create` / `file:update-binary` **без `data`**; жди socket-событий от других peer'ов и качай через `GET /files/:fileId`.
6. Каждое `outcome` проверяй: `conflict_create_renamed` означает, что нужно подкорректировать локальный vault.
