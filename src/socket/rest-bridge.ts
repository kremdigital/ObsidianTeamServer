/**
 * Приём операций, выполненных через REST в веб-процессе, и рассылка их
 * подключённым клиентам.
 *
 * Веб-процесс (:3000) публикует в канал Postgres только идентификаторы —
 * см. `src/lib/realtime/bridge.ts`, где объяснено, почему не весь payload.
 * Здесь строка `OperationLog` подгружается из БД и превращается в то же
 * событие, что рассылают сокетные обработчики, чтобы клиенту было безразлично,
 * каким путём пришла правка.
 */
import type { Server as IOServer } from 'socket.io';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logger';
import { projectRoom } from './auth';
import { subscribeToOperations, type OperationNotification } from '@/lib/realtime/bridge';

export interface SerializedLog {
  id: string;
  vectorClock: unknown;
  createdAt: string;
}

/**
 * Собрать payload события в той форме, которую ждёт плагин.
 *
 * **Форма обязана совпадать с сокетными обработчиками.** Плагин разбирает
 * каждое событие по своим полям и при их отсутствии молча выходит
 * (`if (!data.fileId) return`, `if (!outcome?.fileId) break`) — см.
 * `obsidian-plugin/src/client/socket.ts` и `engine.handleServerFileEvent`.
 * Первая версия моста слала `{ log, filePath }`: события доходили, а клиент
 * не мог их применить — файлы не появлялись в вальте. Отсюда и отдельная
 * функция с тестом на точную форму.
 */
export function buildEventPayload(
  note: OperationNotification,
  log: SerializedLog,
): Record<string, unknown> {
  switch (note.event) {
    case 'file:created':
      // Плагин достаёт fileId и path из `result.outcome`.
      return {
        result: { outcome: { kind: 'created', fileId: note.fileId, path: note.path } },
        log,
      };
    case 'file:updated-binary':
      return { fileId: note.fileId, contentHash: note.contentHash ?? '', log };
    case 'file:deleted':
      return { fileId: note.fileId, log };
    case 'file:renamed':
    case 'file:moved': {
      const target = note.newPath ?? note.path;
      return {
        fileId: note.fileId,
        newPath: target,
        outcome: { kind: 'moved', fileId: note.fileId, path: target },
        log,
      };
    }
  }
}

async function relay(io: IOServer, note: OperationNotification): Promise<void> {
  const row = await prisma.operationLog.findUnique({
    where: { id: note.logId },
    select: { id: true, vectorClock: true, createdAt: true },
  });
  if (!row) {
    logger.warn({ note }, 'операция из канала не найдена в журнале');
    return;
  }
  const log = { id: row.id, vectorClock: row.vectorClock, createdAt: row.createdAt.toISOString() };
  const payload = buildEventPayload(note, log);

  io.to(projectRoom(note.projectId)).emit(note.event, { ...payload, viaRest: true });
  logger.info(
    { event: note.event, path: note.newPath ?? note.path, fileId: note.fileId },
    'REST-операция разослана в комнату',
  );
}

/**
 * Подписаться на канал и рассылать приходящие операции. Возвращает функцию
 * остановки — её вызывает graceful shutdown сокет-сервера.
 */
export function attachRestBridge(io: IOServer): { close: () => Promise<void> } {
  return subscribeToOperations((note) => {
    void relay(io, note).catch((err) =>
      logger.warn({ err, note }, 'не удалось разослать REST-операцию'),
    );
  });
}
