import 'dotenv/config';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server as IOServer } from 'socket.io';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/db/client';
import { getSocketUser, installAuthMiddleware } from './auth';
import { attachProjectHandlers } from './handlers/project';
import { attachFileHandlers } from './handlers/files';
import { attachYjsHandlers } from './handlers/yjs';
import { attachRestBridge } from './rest-bridge';

export interface CreateSocketOptions {
  /** When provided, attach to an existing HTTP server instead of creating one. Useful for tests. */
  httpServer?: HttpServer;
  /** Override the CORS origin (default: PUBLIC_URL env). */
  corsOrigin?: string | string[];
}

/**
 * Origin'ы, которым разрешён socket-хендшейк.
 *
 * Кроме основного `PUBLIC_URL` учитывается `EXTRA_ORIGINS` — список через
 * запятую для доменов-зеркал. Без этого вход на зеркало ломается ровно
 * наполовину: страницы отдаются (их проксирует Caddy), а веб-редактор молча не
 * подключается, потому что рукопожатие идёт с `credentials: true` и браузер
 * режет его по CORS.
 */
export function allowedOrigins(): string | string[] {
  const primary = process.env.PUBLIC_URL ?? 'http://localhost:3000';
  const extra = (process.env.EXTRA_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return extra.length > 0 ? [primary, ...extra] : primary;
}

export function createIoServer(options: CreateSocketOptions = {}): {
  io: IOServer;
  httpServer: HttpServer;
} {
  const httpServer = options.httpServer ?? createServer();
  const corsOrigin = options.corsOrigin ?? allowedOrigins();

  const io = new IOServer(httpServer, {
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
    maxHttpBufferSize: 16 * 1024 * 1024, // 16 MB — file uploads via REST, Yjs ops are tiny
    // A `project:join` for a large vault ships every text file's full Y.Doc
    // state in one ack; the client applies them synchronously (+ disk writes),
    // which can block its event loop for tens of seconds and miss the default
    // 20s heartbeat — causing a reconnect→rejoin livelock. Give the heartbeat
    // generous grace so a heavy catch-up can finish. (Proper fix: stream /
    // diff the catch-up so it never blocks — tracked separately.)
    pingInterval: 25_000,
    pingTimeout: 180_000,
  });

  installAuthMiddleware(io);

  io.on('connection', (socket) => {
    const log = logger.child({ socket: socket.id, userId: getSocketUser(socket).userId });
    log.debug('socket connected');

    attachProjectHandlers(io, socket);
    attachFileHandlers(io, socket);
    attachYjsHandlers(io, socket);

    socket.on('disconnect', (reason) => {
      log.debug({ reason }, 'socket disconnected');
    });
  });

  return { io, httpServer };
}

export interface RunServerOptions {
  port?: number;
}

export async function runStandaloneServer(opts: RunServerOptions = {}): Promise<{
  io: IOServer;
  close: () => Promise<void>;
}> {
  const port = opts.port ?? Number(process.env.PORT_SOCKET ?? 3001);
  const { io, httpServer } = createIoServer();

  // Мост из веб-процесса: правки, сделанные через REST (MCP, внешние клиенты),
  // приходят каналом Postgres и рассылаются в комнату проекта. Без него такие
  // правки не доходят до клиентов вовсе — см. src/lib/realtime/bridge.ts.
  const restBridge = attachRestBridge(io);

  await new Promise<void>((resolve) => {
    httpServer.listen(port, () => resolve());
  });
  logger.info({ port }, 'socket.io listening');

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'graceful shutdown begin');

    // Stop accepting new connections.
    io.close();
    httpServer.close();

    // Disconnect any remaining sockets, close the REST bridge (it holds its own
    // long-lived pg connection for LISTEN), and disconnect Prisma.
    const sockets = await io.fetchSockets();
    for (const s of sockets) s.disconnect(true);
    await restBridge.close().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);

    logger.info('graceful shutdown done');
  }

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  return {
    io,
    close: async () => {
      await shutdown('manual');
    },
  };
}

// Note: This file does NOT auto-start a server when imported. To run a
// standalone Socket.IO process, use `src/socket/main.ts` as the entry point.
// That keeps `createIoServer` / `runStandaloneServer` safely importable from
// tests and other tooling.
