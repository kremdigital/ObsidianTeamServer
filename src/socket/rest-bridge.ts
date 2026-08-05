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

async function relay(io: IOServer, note: OperationNotification): Promise<void> {
  const log = await prisma.operationLog.findUnique({
    where: { id: note.logId },
    select: { id: true, vectorClock: true, createdAt: true, filePath: true, newPath: true },
  });
  if (!log) {
    logger.warn({ note }, 'операция из канала не найдена в журнале');
    return;
  }

  // Форма payload повторяет сокетные обработчики (`serializeLog` + result),
  // но `result.outcome` здесь недоступен: он не хранится в журнале. Клиенту
  // достаточно самой операции — путь, тип и vector clock; содержимое он
  // возьмёт обычным путём (REST-скачивание или Yjs).
  io.to(projectRoom(note.projectId)).emit(note.event, {
    log: { id: log.id, vectorClock: log.vectorClock, createdAt: log.createdAt.toISOString() },
    filePath: log.filePath,
    newPath: log.newPath,
    clientId: note.clientId,
    viaRest: true,
  });

  logger.debug({ event: note.event, path: log.filePath }, 'REST-операция разослана в комнату');
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
