/**
 * Мост «веб-процесс → сокет-процесс» поверх Postgres LISTEN/NOTIFY.
 *
 * Проверяется настоящая доставка через БД: `publishOperation` выполняется как в
 * веб-процессе, `subscribeToOperations` — как в сокетном. Без моста REST-правки
 * не доходят до подключённых клиентов вовсе.
 */
import { afterAll, describe, expect, it } from 'vitest';
import {
  publishOperation,
  subscribeToOperations,
  type OperationNotification,
} from '@/lib/realtime/bridge';
import { testPrisma } from './db';

afterAll(async () => {
  await testPrisma.$disconnect();
});

function waitFor<T>(fn: () => T | undefined, timeoutMs = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = setInterval(() => {
      const value = fn();
      if (value !== undefined) {
        clearInterval(tick);
        resolve(value);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(tick);
        reject(new Error('уведомление не пришло за отведённое время'));
      }
    }, 50);
  });
}

describe('канал операций (LISTEN/NOTIFY)', () => {
  it('доставляет уведомление подписчику', async () => {
    const received: OperationNotification[] = [];
    const sub = subscribeToOperations((note) => received.push(note));

    // Дать подписке установиться: LISTEN выполняется асинхронно после connect.
    await new Promise((r) => setTimeout(r, 1500));

    const note: OperationNotification = {
      projectId: 'p-мост',
      logId: 'log-1',
      event: 'file:created',
      clientId: 'rest:u-1',
    };
    await publishOperation(note);

    const got = await waitFor(() => received.find((n) => n.logId === 'log-1'));
    expect(got).toEqual(note);

    await sub.close();
  });

  it('переживает кириллицу в payload и не падает на мусоре', async () => {
    const received: OperationNotification[] = [];
    const sub = subscribeToOperations((note) => received.push(note));
    await new Promise((r) => setTimeout(r, 1500));

    // Мусор в канале не должен ронять подписчика — только логироваться.
    await testPrisma.$executeRawUnsafe(`SELECT pg_notify('team_vault_operation', 'не json')`);

    const note: OperationNotification = {
      projectId: 'проект-кириллица',
      logId: 'log-2',
      event: 'file:moved',
      clientId: 'rest:u-2',
    };
    await publishOperation(note);

    const got = await waitFor(() => received.find((n) => n.logId === 'log-2'));
    expect(got?.projectId).toBe('проект-кириллица');

    await sub.close();
  });
});
