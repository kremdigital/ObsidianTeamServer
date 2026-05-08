/**
 * Standalone entry point for the Socket.IO process. PM2 (and any other
 * process manager) should point at this file's compiled output —
 * `dist/socket/main.mjs` — rather than `server.ts`, which exports building
 * blocks but does not start anything.
 *
 * Splitting the entry from the library lets tests (and any other consumer)
 * `import { createIoServer }` from `./server` without accidentally booting
 * a real listener.
 */
import { runStandaloneServer } from './server';

void runStandaloneServer();
