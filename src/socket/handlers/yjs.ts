import type { Server, Socket } from 'socket.io';
import { prisma } from '@/lib/db/client';
import { canEditFiles, canViewProject, loadProjectAccess } from '@/lib/auth/permissions';
import { applyYjsUpdate, loadOrSeedYjsSnapshot, scheduleSnapshot } from '@/lib/crdt/persistence';
import { child } from '@/lib/logger';
import { getSocketUser, projectRoom } from '../auth';

interface YjsUpdateMsg {
  projectId: string;
  fileId: string;
  /** Yjs binary update encoded as a number array (over JSON). */
  update: number[];
}

interface YjsFetchMsg {
  projectId: string;
  fileId: string;
}

type Ack = (response: { ok: true; changed: boolean } | { ok: false; error: string }) => void;

type FetchAck = (
  response: { ok: true; sync1: number[]; stateVector: number[] } | { ok: false; error: string },
) => void;

export function attachYjsHandlers(io: Server, socket: Socket): void {
  const log = child({ socket: socket.id, userId: getSocketUser(socket).userId });

  socket.on('yjs:update', async (raw: YjsUpdateMsg, ack: Ack) => {
    if (
      !raw ||
      typeof raw.projectId !== 'string' ||
      typeof raw.fileId !== 'string' ||
      !Array.isArray(raw.update)
    ) {
      ack({ ok: false, error: 'invalid_payload' });
      return;
    }

    const userId = getSocketUser(socket).userId;
    const access = await loadProjectAccess({ id: userId, role: 'USER' }, raw.projectId);
    if (!access) {
      ack({ ok: false, error: 'project_not_found' });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) {
      ack({ ok: false, error: 'user_not_found' });
      return;
    }
    if (!canEditFiles({ id: userId, role: user.role }, access)) {
      ack({ ok: false, error: 'forbidden' });
      return;
    }

    // Verify the file actually belongs to the project.
    const file = await prisma.vaultFile.findFirst({
      where: { id: raw.fileId, projectId: raw.projectId, deletedAt: null },
      select: { id: true },
    });
    if (!file) {
      ack({ ok: false, error: 'file_not_found' });
      return;
    }

    const update = Uint8Array.from(raw.update);
    try {
      const result = await applyYjsUpdate({ fileId: raw.fileId, update, authorId: userId });

      if (result.changed) {
        socket.to(projectRoom(raw.projectId)).emit('yjs:update', {
          fileId: raw.fileId,
          update: Array.from(update),
        });
        scheduleSnapshot({
          projectId: raw.projectId,
          fileId: raw.fileId,
          authorId: userId,
          onError: (err) => log.error({ err, fileId: raw.fileId }, 'snapshot failed'),
        });
      }

      ack({ ok: true, changed: result.changed });
    } catch (err) {
      log.error({ err, fileId: raw.fileId }, 'yjs:update failed');
      ack({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
    }
  });

  // Fetch a single doc's current Y.Doc state. Lets a web client edit one note
  // without the full-vault catch-up of `project:join`. Read access is enough to
  // load state; mutating it still goes through `yjs:update` (canEditFiles).
  socket.on('yjs:fetch', async (raw: YjsFetchMsg, ack: FetchAck) => {
    if (!raw || typeof raw.projectId !== 'string' || typeof raw.fileId !== 'string') {
      ack({ ok: false, error: 'invalid_payload' });
      return;
    }

    const userId = getSocketUser(socket).userId;
    const access = await loadProjectAccess({ id: userId, role: 'USER' }, raw.projectId);
    if (!access) {
      ack({ ok: false, error: 'project_not_found' });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) {
      ack({ ok: false, error: 'user_not_found' });
      return;
    }
    if (!canViewProject({ id: userId, role: user.role }, access)) {
      ack({ ok: false, error: 'forbidden' });
      return;
    }

    const file = await prisma.vaultFile.findFirst({
      where: { id: raw.fileId, projectId: raw.projectId, deletedAt: null, fileType: 'TEXT' },
      select: { id: true, path: true },
    });
    if (!file) {
      ack({ ok: false, error: 'file_not_found' });
      return;
    }

    try {
      const snapshot = await loadOrSeedYjsSnapshot(raw.projectId, file.id, file.path);
      ack({
        ok: true,
        sync1: Array.from(snapshot.state),
        stateVector: Array.from(snapshot.stateVector),
      });
    } catch (err) {
      log.error({ err, fileId: raw.fileId }, 'yjs:fetch failed');
      ack({ ok: false, error: err instanceof Error ? err.message : 'unknown' });
    }
  });
}
