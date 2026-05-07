import type { Server, Socket } from 'socket.io';
import { prisma } from '@/lib/db/client';
import { canEditFiles, loadProjectAccess } from '@/lib/auth/permissions';
import { applyOperation, type OperationInput } from '@/lib/sync/operation-log';
import { increment, type VectorClock, parseClock } from '@/lib/sync/vector-clock';
import { child } from '@/lib/logger';
import { getSocketUser, projectRoom } from '../auth';

interface BaseEnvelope {
  projectId: string;
  clientId: string;
  vectorClock?: VectorClock;
}

type FileCreateMsg = BaseEnvelope & {
  filePath: string;
  fileType: 'TEXT' | 'BINARY';
  mimeType?: string | null;
  contentHash: string;
  size: number;
  data: number[]; // base64 would be lighter; numbers[] is simpler over JSON
};
type FileUpdateBinaryMsg = BaseEnvelope & {
  fileId: string;
  contentHash: string;
  size: number;
  data: number[];
};
type FileDeleteMsg = BaseEnvelope & { fileId: string; filePath: string };
type FileMoveMsg = BaseEnvelope & { fileId: string; filePath: string; newPath: string };

type Ack = (response: { ok: true; outcome: unknown } | { ok: false; error: string }) => void;

async function withEditAccess(
  socket: Socket,
  projectId: string,
  ack: Ack,
): Promise<{ ok: true; userId: string; role: 'USER' | 'SUPERADMIN' } | { ok: false }> {
  const userId = getSocketUser(socket).userId;
  const access = await loadProjectAccess({ id: userId, role: 'USER' }, projectId);
  if (!access) {
    ack({ ok: false, error: 'project_not_found' });
    return { ok: false };
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) {
    ack({ ok: false, error: 'user_not_found' });
    return { ok: false };
  }
  if (!canEditFiles({ id: userId, role: user.role }, access)) {
    ack({ ok: false, error: 'forbidden' });
    return { ok: false };
  }
  return { ok: true, userId, role: user.role };
}

export function attachFileHandlers(io: Server, socket: Socket): void {
  const log = child({ socket: socket.id, userId: getSocketUser(socket).userId });

  socket.on('file:create', async (raw: FileCreateMsg, ack: Ack) => {
    const auth = await withEditAccess(socket, raw.projectId, ack);
    if (!auth.ok) return;

    const op: OperationInput = {
      opType: 'CREATE',
      filePath: raw.filePath,
      payload: {
        fileType: raw.fileType,
        mimeType: raw.mimeType ?? null,
        contentHash: raw.contentHash,
        size: raw.size,
      },
      data: Buffer.from(raw.data),
    };

    try {
      const result = await applyOperation(
        {
          projectId: raw.projectId,
          authorId: auth.userId,
          clientId: raw.clientId,
          vectorClock: increment(parseClock(raw.vectorClock), raw.clientId),
        },
        op,
      );
      io.to(projectRoom(raw.projectId)).emit('file:created', {
        result,
        log: serializeLog(result.log),
      });
      ack({ ok: true, outcome: result.outcome });
    } catch (err) {
      log.error({ err }, 'file:create failed');
      ack({ ok: false, error: errorMessage(err) });
    }
  });

  socket.on('file:update-binary', async (raw: FileUpdateBinaryMsg, ack: Ack) => {
    const auth = await withEditAccess(socket, raw.projectId, ack);
    if (!auth.ok) return;

    const op: OperationInput = {
      opType: 'UPDATE',
      filePath: '', // resolved by fileId in applyOperation
      payload: { fileId: raw.fileId, contentHash: raw.contentHash, size: raw.size },
      data: Buffer.from(raw.data),
    };

    try {
      const result = await applyOperation(
        {
          projectId: raw.projectId,
          authorId: auth.userId,
          clientId: raw.clientId,
          vectorClock: increment(parseClock(raw.vectorClock), raw.clientId),
        },
        op,
      );
      io.to(projectRoom(raw.projectId)).emit('file:updated-binary', {
        fileId: raw.fileId,
        contentHash: raw.contentHash,
        log: serializeLog(result.log),
      });
      ack({ ok: true, outcome: result.outcome });
    } catch (err) {
      log.error({ err }, 'file:update-binary failed');
      ack({ ok: false, error: errorMessage(err) });
    }
  });

  socket.on('file:delete', async (raw: FileDeleteMsg, ack: Ack) => {
    const auth = await withEditAccess(socket, raw.projectId, ack);
    if (!auth.ok) return;

    try {
      const result = await applyOperation(
        {
          projectId: raw.projectId,
          authorId: auth.userId,
          clientId: raw.clientId,
          vectorClock: increment(parseClock(raw.vectorClock), raw.clientId),
        },
        { opType: 'DELETE', filePath: raw.filePath, payload: { fileId: raw.fileId } },
      );
      io.to(projectRoom(raw.projectId)).emit('file:deleted', {
        fileId: raw.fileId,
        log: serializeLog(result.log),
      });
      ack({ ok: true, outcome: result.outcome });
    } catch (err) {
      log.error({ err }, 'file:delete failed');
      ack({ ok: false, error: errorMessage(err) });
    }
  });

  socket.on('file:rename', (raw: FileMoveMsg, ack: Ack) =>
    handleMove(io, socket, raw, ack, 'RENAME'),
  );
  socket.on('file:move', (raw: FileMoveMsg, ack: Ack) => handleMove(io, socket, raw, ack, 'MOVE'));
}

async function handleMove(
  io: Server,
  socket: Socket,
  raw: FileMoveMsg,
  ack: Ack,
  opType: 'RENAME' | 'MOVE',
): Promise<void> {
  const auth = await withEditAccess(socket, raw.projectId, ack);
  if (!auth.ok) return;

  try {
    const result = await applyOperation(
      {
        projectId: raw.projectId,
        authorId: auth.userId,
        clientId: raw.clientId,
        vectorClock: increment(parseClock(raw.vectorClock), raw.clientId),
      },
      { opType, filePath: raw.filePath, newPath: raw.newPath, payload: { fileId: raw.fileId } },
    );
    io.to(projectRoom(raw.projectId)).emit(opType === 'RENAME' ? 'file:renamed' : 'file:moved', {
      fileId: raw.fileId,
      newPath: raw.newPath,
      outcome: result.outcome,
      log: serializeLog(result.log),
    });
    ack({ ok: true, outcome: result.outcome });
  } catch (err) {
    child({ socket: socket.id }).error({ err }, `${opType.toLowerCase()} failed`);
    ack({ ok: false, error: errorMessage(err) });
  }
}

function serializeLog(log: { id: string; vectorClock: unknown; createdAt: Date }) {
  return {
    id: log.id,
    vectorClock: log.vectorClock,
    createdAt: log.createdAt.toISOString(),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown_error';
}
