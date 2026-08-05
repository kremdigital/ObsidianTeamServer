/**
 * Мост «веб-процесс → сокет-процесс» поверх Postgres `LISTEN/NOTIFY`.
 *
 * Записи через REST (MCP, внешние клиенты, загрузка из веб-UI) выполняются в
 * процессе Next.js на :3000, а подключённые клиенты синхронизации живут в
 * отдельном процессе Socket.IO на :3001. Прямого канала между ними нет,
 * поэтому такие правки раньше не доходили до плагина вовсе — ни вживую, ни
 * при переподключении.
 *
 * Postgres выбран потому, что уже есть у обоих процессов: ни Redis, ни
 * внутреннего HTTP-эндпоинта заводить не нужно.
 *
 * **В payload идут только идентификаторы.** У `NOTIFY` жёсткий лимит ~8000
 * байт, а сериализованная операция (тем более Yjs-стейт) легко его перебьёт.
 * Подписчик получает `logId` и сам подгружает всё нужное из БД.
 */
import { Client } from 'pg';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logger';

/** Имя канала Postgres. Меняется только вместе с подписчиком в сокет-процессе. */
export const OPERATION_CHANNEL = 'team_vault_operation';

export interface OperationNotification {
  projectId: string;
  /** Строка `OperationLog`, по которой подписчик соберёт событие. */
  logId: string;
  /** Socket.IO-событие, которое надо разослать в комнату проекта. */
  event: 'file:created' | 'file:updated-binary' | 'file:deleted' | 'file:renamed' | 'file:moved';
  /**
   * Клиент-инициатор. Сокет-процесс рассылает событие всем в комнате: у
   * REST-вызова нет своего сокета, поэтому исключать некого, а `clientId`
   * нужен клиентам, чтобы не принять собственную правку за чужую.
   */
  clientId: string;
}

/**
 * Оповестить сокет-процесс о применённой операции.
 *
 * Best-effort: сбой уведомления не должен ронять уже выполненный REST-запрос —
 * данные записаны, операция в журнале, клиенты подтянут её при следующем
 * `project:join`. Поэтому только логируем.
 */
export async function publishOperation(note: OperationNotification): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `SELECT pg_notify($1, $2)`,
      OPERATION_CHANNEL,
      JSON.stringify(note),
    );
  } catch (err) {
    logger.warn({ err, note }, 'не удалось опубликовать операцию в канал сокета');
  }
}

/**
 * Подписаться на канал (вызывается в сокет-процессе).
 *
 * Используется отдельное соединение `pg`, а не Prisma: `LISTEN` требует
 * долгоживущего соединения, которое нельзя возвращать в пул между запросами.
 * При обрыве соединение переподключается с задержкой — иначе после рестарта
 * Postgres мост молча умрёт.
 */
export function subscribeToOperations(
  onNotification: (note: OperationNotification) => void,
  opts: { connectionString?: string; retryMs?: number } = {},
): { close: () => Promise<void> } {
  const connectionString = opts.connectionString ?? process.env.DATABASE_URL;
  const retryMs = opts.retryMs ?? 5000;
  let client: Client | null = null;
  let closed = false;
  let retryTimer: NodeJS.Timeout | null = null;

  async function connect(): Promise<void> {
    if (closed) return;
    const next = new Client({ connectionString });
    next.on('error', (err) => {
      logger.warn({ err }, 'соединение канала операций упало, переподключаюсь');
      scheduleRetry();
    });
    next.on('notification', (msg) => {
      if (!msg.payload) return;
      try {
        onNotification(JSON.parse(msg.payload) as OperationNotification);
      } catch (err) {
        logger.warn({ err, payload: msg.payload }, 'нечитаемое уведомление из канала операций');
      }
    });
    try {
      await next.connect();
      await next.query(`LISTEN ${OPERATION_CHANNEL}`);
      client = next;
      logger.info({ channel: OPERATION_CHANNEL }, 'подписка на канал операций установлена');
    } catch (err) {
      logger.warn({ err }, 'не удалось подписаться на канал операций');
      await next.end().catch(() => undefined);
      scheduleRetry();
    }
  }

  function scheduleRetry(): void {
    if (closed || retryTimer) return;
    const prev = client;
    client = null;
    void prev?.end().catch(() => undefined);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, retryMs);
    retryTimer.unref?.();
  }

  void connect();

  return {
    async close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      await client?.end().catch(() => undefined);
      client = null;
    },
  };
}
