'use client';

import { io, type Socket } from 'socket.io-client';

/**
 * Shared browser Socket.IO connection to the Team Vault realtime server.
 *
 * Auth is implicit: the browser sends the httpOnly `osync_access` session
 * cookie with the handshake (`withCredentials`), which the socket server
 * verifies (see `src/socket/auth.ts`). No token handling in JS is needed.
 *
 * In production the socket shares the web origin (Caddy proxies `/socket.io/*`
 * to the socket process), so the URL is left empty (same-origin). In local dev
 * the socket runs on a separate port — set `NEXT_PUBLIC_SOCKET_URL` (e.g.
 * `http://localhost:3001`).
 */
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  const url = process.env.NEXT_PUBLIC_SOCKET_URL;
  const options = {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    autoConnect: true,
  };
  socket = url ? io(url, options) : io(options);
  return socket;
}

/** Emit an event and await its ack, rejecting on timeout. */
export function emitAck<T>(
  socket: Socket,
  event: string,
  payload: unknown,
  timeoutMs = 15000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), timeoutMs);
    socket.emit(event, payload, (response: T) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}
