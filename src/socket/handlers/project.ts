import * as Y from 'yjs';
import type { Server, Socket } from 'socket.io';
import { prisma } from '@/lib/db/client';
import { canViewProject, loadProjectAccess } from '@/lib/auth/permissions';
import { listOperationsSince } from '@/lib/sync/operation-log';
import { type VectorClock, parseClock } from '@/lib/sync/vector-clock';
import { buildInitialState } from '@/lib/crdt/persistence';
import { readProjectFile } from '@/lib/files/storage';
import { child } from '@/lib/logger';
import { getSocketUser, projectRoom } from '../auth';

export interface JoinPayload {
  projectId: string;
  sinceVectorClock?: VectorClock | null;
}

export interface JoinAckPayload {
  ok: true;
  operations: Array<{
    id: string;
    opType: string;
    filePath: string;
    newPath: string | null;
    authorId: string | null;
    vectorClock: VectorClock;
    payload: unknown;
    createdAt: Date;
  }>;
  /**
   * Per-text-file state snapshots. `sync1` is the server's full Y.Doc state;
   * the client applies it to merge in anything it's missing. `stateVector`
   * lets the client compute the inverse — operations the *server* doesn't
   * have yet (typically offline edits made while disconnected) — and push
   * them back via `yjs:update`. Without this round-trip, offline edits stay
   * stuck client-side forever and the server treats every subsequent live
   * edit as a no-op replay (the parent structs of the new op are missing).
   */
  yjsDocs: Array<{ fileId: string; sync1: number[]; stateVector: number[] }>;
}

export type JoinAck = JoinAckPayload | { ok: false; error: string };

export function attachProjectHandlers(_io: Server, socket: Socket): void {
  const log = child({ socket: socket.id, userId: getSocketUser(socket).userId });

  socket.on('project:join', async (raw: unknown, cb: (ack: JoinAck) => void) => {
    const payload = parseJoinPayload(raw);
    if (!payload) {
      cb({ ok: false, error: 'invalid_payload' });
      return;
    }

    const access = await loadProjectAccess(
      { id: getSocketUser(socket).userId, role: 'USER' },
      payload.projectId,
    );
    if (!access) {
      cb({ ok: false, error: 'project_not_found' });
      return;
    }

    // Need the user's role from DB for permission decisions.
    const user = await prisma.user.findUnique({
      where: { id: getSocketUser(socket).userId },
      select: { role: true },
    });
    if (!user) {
      cb({ ok: false, error: 'user_not_found' });
      return;
    }
    const actor = { id: getSocketUser(socket).userId, role: user.role };
    if (!canViewProject(actor, access)) {
      cb({ ok: false, error: 'forbidden' });
      return;
    }

    await socket.join(projectRoom(payload.projectId));

    // 1) Operation log catch-up.
    const ops = await listOperationsSince({
      projectId: payload.projectId,
      since: payload.sinceVectorClock ?? {},
    });

    // 2) Yjs sync-step1 for every text doc — clients merge with their local state.
    const textFiles = await prisma.vaultFile.findMany({
      where: { projectId: payload.projectId, deletedAt: null, fileType: 'TEXT' },
      select: { id: true, path: true },
    });
    const yjsRows = await prisma.yjsDocument.findMany({
      where: { fileId: { in: textFiles.map((f) => f.id) } },
      select: { fileId: true, state: true },
    });
    const stateByFileId = new Map<string, Uint8Array>(
      yjsRows.map((r) => [r.fileId, new Uint8Array(r.state)]),
    );

    // Lazy-seed any text file that has bytes on disk but no Yjs doc — covers
    // both legacy files created before the seed-on-create patch and any
    // future drift if a snapshot got dropped manually.
    const yjsDocs: Array<{ fileId: string; sync1: number[]; stateVector: number[] }> = [];
    for (const file of textFiles) {
      let state = stateByFileId.get(file.id);
      if (!state) {
        try {
          const buf = await readProjectFile(payload.projectId, file.path);
          const text = buf.toString('utf8');
          const initial = buildInitialState(text);
          await prisma.yjsDocument.upsert({
            where: { fileId: file.id },
            create: {
              fileId: file.id,
              state: Buffer.from(initial.state),
              stateVector: Buffer.from(initial.stateVector),
            },
            update: {
              state: Buffer.from(initial.state),
              stateVector: Buffer.from(initial.stateVector),
            },
          });
          state = initial.state;
        } catch (err) {
          log.warn({ err, fileId: file.id, path: file.path }, 'yjs seed failed');
          continue;
        }
      }
      const doc = new Y.Doc();
      Y.applyUpdate(doc, state);
      const sync1 = Y.encodeStateAsUpdate(doc);
      const stateVector = Y.encodeStateVector(doc);
      doc.destroy();
      yjsDocs.push({
        fileId: file.id,
        sync1: Array.from(sync1),
        stateVector: Array.from(stateVector),
      });
    }

    log.info(
      { projectId: payload.projectId, ops: ops.length, docs: yjsDocs.length },
      'project:join',
    );

    cb({
      ok: true,
      operations: ops.map((o) => ({
        id: o.id,
        opType: o.opType,
        filePath: o.filePath,
        newPath: o.newPath,
        authorId: o.authorId,
        vectorClock: o.vectorClock as VectorClock,
        payload: o.payload,
        createdAt: o.createdAt,
      })),
      yjsDocs,
    });
  });

  socket.on('project:leave', async (raw: unknown, cb?: (ack: { ok: true }) => void) => {
    const projectId =
      typeof raw === 'object' && raw !== null && 'projectId' in raw
        ? String((raw as { projectId: unknown }).projectId)
        : null;
    if (projectId) {
      await socket.leave(projectRoom(projectId));
    }
    cb?.({ ok: true });
  });
}

function parseJoinPayload(raw: unknown): JoinPayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Record<string, unknown>;
  if (typeof data['projectId'] !== 'string') return null;
  return {
    projectId: data['projectId'],
    sinceVectorClock: parseClock(data['sinceVectorClock']),
  };
}
