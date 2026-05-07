import type { Server, Socket } from 'socket.io';
import { authenticateApiKey, API_KEY_HEADER } from '@/lib/auth/api-key-middleware';
import { isWellFormedApiKey } from '@/lib/auth/api-key';

export interface SocketUserData {
  userId: string;
  apiKeyId: string;
}

/**
 * Read the authenticated user data attached by {@link installAuthMiddleware}.
 * We don't use module augmentation on `Socket['data']` because socket.io's
 * `data` type is constrained via Server's generic parameters.
 */
export function getSocketUser(socket: Socket): SocketUserData {
  return socket.data as SocketUserData;
}

/**
 * Build a faux Request to reuse `authenticateApiKey` from REST land.
 * The API key is read from `socket.handshake.auth.apiKey` first, then falls back
 * to the standard `x-api-key` header.
 */
function buildAuthRequest(socket: Socket): Request | null {
  const handshakeKey = (socket.handshake.auth?.['apiKey'] ?? '') as string;
  const headerKey = socket.handshake.headers[API_KEY_HEADER];
  const plain = (handshakeKey || (typeof headerKey === 'string' ? headerKey : ''))?.trim();
  if (!plain || !isWellFormedApiKey(plain)) return null;
  return new Request('http://localhost/socket-auth', {
    headers: { [API_KEY_HEADER]: plain },
  });
}

export function installAuthMiddleware(io: Server): void {
  io.use(async (socket, next) => {
    const req = buildAuthRequest(socket);
    if (!req) {
      next(new Error('unauthorized'));
      return;
    }
    try {
      const result = await authenticateApiKey(req);
      if (!result) {
        next(new Error('unauthorized'));
        return;
      }
      socket.data = { userId: result.user.id, apiKeyId: result.apiKeyId };
      next();
    } catch (err) {
      next(err instanceof Error ? err : new Error('auth_failed'));
    }
  });
}

export function projectRoom(projectId: string): string {
  return `project:${projectId}`;
}
