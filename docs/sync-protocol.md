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
  auth: { apiKey: "osync_<64hex>" }

→ project:join { projectId, sinceVectorClock? }
← ack {
    ok: true,
    operations: OperationLogRow[],   // упорядочены по createdAt asc
    yjsDocs: [{ fileId, sync1: number[] }]   // полный state каждого Yjs-документа
  }
```

`sinceVectorClock` — клиент шлёт свой локальный vc. Сервер вернёт операции, чей `OperationLog.vectorClock` имеет хоть в одной координате больше, чем `since`.

После catch-up клиент **должен**:

1. Применить операции в порядке от сервера.
2. Для каждого `yjsDocs[i]` сделать `Y.applyUpdate(localDoc[fileId], Uint8Array.from(sync1))` — это симметрично объединит state.

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

Yjs не используется. Загрузка через **REST**:

```
POST /api/projects/:id/files (multipart/form-data)
PUT  /api/projects/:id/files/:fileId   (raw body — обновление)
```

После успешной загрузки сервер шлёт socket-событие `file:updated-binary` другим клиентам с `contentHash`. Клиенты сами скачивают новый файл через `GET /api/projects/:id/files/:fileId`.

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
5. Для бинарных — REST upload + жди socket-события `file:updated-binary` от других peer'ов.
6. Каждое `outcome` проверяй: `conflict_create_renamed` означает, что нужно подкорректировать локальный vault.
