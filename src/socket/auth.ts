import type { Server, Socket } from 'socket.io';
import { authenticateApiKey, API_KEY_HEADER } from '@/lib/auth/api-key-middleware';
import { isWellFormedApiKey } from '@/lib/auth/api-key';
import { verifyAccessToken } from '@/lib/auth/jwt-verify';

/** Name of the session access-token cookie set by the web app (see lib/auth/cookies.ts). */
const ACCESS_COOKIE_NAME = 'osync_access';

export interface SocketUserData {
  userId: string;
  /** Set when the connection authenticated via an API key (plugin); null for cookie/JWT (web). */
  apiKeyId: string | null;
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

/** Extract a single cookie value from a raw `Cookie:` header. */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

/**
 * Resolve a browser session token from the handshake: the `osync_access`
 * cookie (sent automatically by the browser with `withCredentials`, even
 * though it is httpOnly) or, as a fallback, an explicit `auth.token`.
 */
function readSessionToken(socket: Socket): string | null {
  const cookie = readCookie(socket.handshake.headers.cookie, ACCESS_COOKIE_NAME);
  if (cookie) return cookie;
  const fromAuth = socket.handshake.auth?.['token'];
  return typeof fromAuth === 'string' && fromAuth.length > 0 ? fromAuth : null;
}

export function installAuthMiddleware(io: Server): void {
  io.use(async (socket, next) => {
    try {
      // 1) API key (Obsidian plugin / programmatic clients).
      const req = buildAuthRequest(socket);
      if (req) {
        const result = await authenticateApiKey(req);
        if (result) {
          socket.data = { userId: result.user.id, apiKeyId: result.apiKeyId };
          next();
          return;
        }
      }

      // 2) Session JWT (browser / web UI). Permission checks downstream
      // (canViewProject / canEditFiles) still gate every action, so a VIEWER
      // can connect but cannot mutate.
      const token = readSessionToken(socket);
      if (token) {
        const payload = await verifyAccessToken(token);
        if (payload) {
          socket.data = { userId: payload.sub, apiKeyId: null };
          next();
          return;
        }
      }

      next(new Error('unauthorized'));
    } catch (err) {
      next(err instanceof Error ? err : new Error('auth_failed'));
    }
  });
}

export function projectRoom(projectId: string): string {
  return `project:${projectId}`;
}
