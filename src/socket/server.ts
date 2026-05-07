import 'dotenv/config';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server as IOServer } from 'socket.io';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/db/client';
import { getSocketUser, installAuthMiddleware } from './auth';
import { attachProjectHandlers } from './handlers/project';
import { attachFileHandlers } from './handlers/files';
import { attachYjsHandlers } from './handlers/yjs';

export interface CreateSocketOptions {
  /** When provided, attach to an existing HTTP server instead of creating one. Useful for tests. */
  httpServer?: HttpServer;
  /** Override the CORS origin (default: PUBLIC_URL env). */
  corsOrigin?: string | string[];
}

export function createIoServer(options: CreateSocketOptions = {}): {
  io: IOServer;
  httpServer: HttpServer;
} {
  const httpServer = options.httpServer ?? createServer();
  const corsOrigin = options.corsOrigin ?? process.env.PUBLIC_URL ?? 'http://localhost:3000';

  const io = new IOServer(httpServer, {
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
    maxHttpBufferSize: 16 * 1024 * 1024, // 16 MB — file uploads via REST, Yjs ops are tiny
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

    // Disconnect any remaining sockets and disconnect Prisma.
    const sockets = await io.fetchSockets();
    for (const s of sockets) s.disconnect(true);
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

// When run directly (`tsx src/socket/server.ts` or compiled), start listening.
const isMain = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`;
if (isMain) {
  void runStandaloneServer();
}
