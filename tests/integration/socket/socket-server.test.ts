import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server as HttpServer } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Server as IOServer, type ServerOptions } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createIoServer } from '@/socket/server';
import { generateApiKey } from '@/lib/auth/api-key';
import { TEXT_KEY } from '@/lib/crdt/persistence';
import { resetDatabase, testPrisma } from '../db';

let httpServer: HttpServer;
let io: IOServer;
let port: number;
let storageRoot: string;
let originalStoragePath: string | undefined;

beforeAll(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'osync-socket-'));
  originalStoragePath = process.env.STORAGE_PATH;
  process.env.STORAGE_PATH = storageRoot;

  httpServer = createServer();
  ({ io } = createIoServer({ httpServer, corsOrigin: '*' } as {
    httpServer: HttpServer;
  } & Partial<ServerOptions>));
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = httpServer.address();
  if (!addr || typeof addr === 'string') throw new Error('failed to bind');
  port = addr.port;
});

afterAll(async () => {
  io.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  if (originalStoragePath !== undefined) process.env.STORAGE_PATH = originalStoragePath;
  else delete process.env.STORAGE_PATH;
  await rm(storageRoot, { recursive: true, force: true });
  await testPrisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

const openClients: ClientSocket[] = [];
afterEach(() => {
  for (const c of openClients) c.disconnect();
  openClients.length = 0;
});

async function bootstrapUserAndKey(name: string) {
  const user = await testPrisma.user.create({
    data: {
      email: `${name}-${Date.now()}-${Math.random()}@x.test`,
      passwordHash: 'h',
      name,
    },
  });
  const k = await generateApiKey();
  await testPrisma.apiKey.create({
    data: { userId: user.id, name: 'cli', keyHash: k.hash, keyPrefix: k.prefix },
  });
  return { userId: user.id, plainKey: k.plain };
}

async function createProject(ownerId: string) {
  return testPrisma.project.create({
    data: {
      slug: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: 'P',
      ownerId,
      members: { create: { userId: ownerId, role: 'ADMIN', addedById: ownerId } },
    },
  });
}

function connect(apiKey: string): ClientSocket {
  const c = ioClient(`http://127.0.0.1:${port}`, {
    auth: { apiKey },
    transports: ['websocket'],
    reconnection: false,
  });
  openClients.push(c);
  return c;
}

function emitWithAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout for ${event}`)), 5000);
    socket.emit(event, payload, (ack: T) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

describe('socket auth', () => {
  it('rejects connection without an api key', async () => {
    const c = connect('');
    await expect(
      new Promise<never>((resolve, reject) => {
        c.on('connect_error', (err) => reject(err));
        c.on('connect', () => resolve(null as never));
      }),
    ).rejects.toThrow();
  });

  it('rejects malformed key', async () => {
    const c = connect('not-an-osync-key');
    await expect(
      new Promise<never>((_resolve, reject) => {
        c.on('connect_error', (err) => reject(err));
      }),
    ).rejects.toThrow();
  });

  it('accepts a valid key', async () => {
    const { plainKey } = await bootstrapUserAndKey('auth-ok');
    const c = connect(plainKey);
    await new Promise<void>((resolve, reject) => {
      c.on('connect', () => resolve());
      c.on('connect_error', (err) => reject(err));
    });
    expect(c.connected).toBe(true);
  });
});

describe('project:join', () => {
  it('returns operations after sinceVectorClock and yjs docs', async () => {
    const { userId, plainKey } = await bootstrapUserAndKey('joiner');
    const project = await createProject(userId);

    // Seed an operation directly in the log for catch-up.
    await testPrisma.operationLog.create({
      data: {
        projectId: project.id,
        opType: 'CREATE',
        filePath: 'note.md',
        authorId: userId,
        vectorClock: { 'client-A': 1 },
        payload: { fileType: 'TEXT', contentHash: 'abc', size: 1 },
      },
    });

    const c = connect(plainKey);
    await new Promise<void>((resolve) => c.on('connect', () => resolve()));

    const ack = await emitWithAck<{
      ok: true;
      operations: { filePath: string }[];
      yjsDocs: unknown[];
    }>(c, 'project:join', { projectId: project.id, sinceVectorClock: {} });

    expect(ack.ok).toBe(true);
    expect(ack.operations).toHaveLength(1);
    expect(ack.operations[0]?.filePath).toBe('note.md');
    expect(ack.yjsDocs).toEqual([]);
  });

  it('refuses join for a non-member project', async () => {
    const { plainKey } = await bootstrapUserAndKey('outsider');
    const otherOwner = await testPrisma.user.create({
      data: { email: `o-${Date.now()}@x.test`, passwordHash: 'h', name: 'O' },
    });
    const project = await createProject(otherOwner.id);

    const c = connect(plainKey);
    await new Promise<void>((resolve) => c.on('connect', () => resolve()));
    const ack = await emitWithAck<{ ok: false; error: string } | { ok: true }>(c, 'project:join', {
      projectId: project.id,
    });
    expect(ack.ok).toBe(false);
    if (ack.ok === false) expect(ack.error).toBe('forbidden');
  });
});

describe('file:create', () => {
  it('broadcasts the new file to other room members', async () => {
    const { userId: aId, plainKey: aKey } = await bootstrapUserAndKey('A');
    const project = await createProject(aId);

    const memberB = await testPrisma.user.create({
      data: { email: `b-${Date.now()}@x.test`, passwordHash: 'h', name: 'B' },
    });
    await testPrisma.projectMember.create({
      data: { projectId: project.id, userId: memberB.id, role: 'EDITOR', addedById: aId },
    });
    const k = await generateApiKey();
    await testPrisma.apiKey.create({
      data: { userId: memberB.id, name: 'cli', keyHash: k.hash, keyPrefix: k.prefix },
    });
    const bKey = k.plain;

    const a = connect(aKey);
    const b = connect(bKey);
    await Promise.all([
      new Promise<void>((r) => a.on('connect', () => r())),
      new Promise<void>((r) => b.on('connect', () => r())),
    ]);

    await emitWithAck(a, 'project:join', { projectId: project.id });
    await emitWithAck(b, 'project:join', { projectId: project.id });

    const broadcastReceived = new Promise<{ result: { outcome: { kind: string } } }>((resolve) => {
      b.once('file:created', (data) => resolve(data as never));
    });

    await emitWithAck(a, 'file:create', {
      projectId: project.id,
      clientId: 'client-A',
      filePath: 'shared.md',
      fileType: 'TEXT',
      contentHash: 'abc',
      size: 5,
      data: Array.from(Buffer.from('hello')),
    });

    const broadcast = await broadcastReceived;
    expect(broadcast.result.outcome.kind).toBe('created');

    const file = await testPrisma.vaultFile.findFirst({
      where: { projectId: project.id, path: 'shared.md' },
    });
    expect(file).not.toBeNull();
  });

  it('broadcasts the seeded Yjs state alongside file:created for TEXT', async () => {
    // Without this, a new .md file created by one client (e.g. via shell
    // + chokidar) appears in the receiver's file index but the doc stays
    // empty until they reconnect. The server seeds Yjs on CREATE; this
    // test verifies the seed reaches the room as a `yjs:update` so peers
    // materialise the content immediately.
    const { userId: aId, plainKey: aKey } = await bootstrapUserAndKey('seedA');
    const project = await createProject(aId);
    const memberB = await testPrisma.user.create({
      data: { email: `b-${Date.now()}@x.test`, passwordHash: 'h', name: 'B' },
    });
    await testPrisma.projectMember.create({
      data: { projectId: project.id, userId: memberB.id, role: 'EDITOR', addedById: aId },
    });
    const k = await generateApiKey();
    await testPrisma.apiKey.create({
      data: { userId: memberB.id, name: 'cli', keyHash: k.hash, keyPrefix: k.prefix },
    });
    const bKey = k.plain;

    const a = connect(aKey);
    const b = connect(bKey);
    await Promise.all([
      new Promise<void>((r) => a.on('connect', () => r())),
      new Promise<void>((r) => b.on('connect', () => r())),
    ]);
    await emitWithAck(a, 'project:join', { projectId: project.id });
    await emitWithAck(b, 'project:join', { projectId: project.id });

    const yjsBroadcast = new Promise<{ fileId: string; update: number[] }>((resolve) => {
      b.once('yjs:update', (data) => resolve(data as never));
    });

    await emitWithAck(a, 'file:create', {
      projectId: project.id,
      clientId: 'client-A',
      filePath: 'fresh.md',
      fileType: 'TEXT',
      contentHash: 'h',
      size: 11,
      data: Array.from(Buffer.from('born in cli')),
    });

    const msg = await yjsBroadcast;
    expect(msg.fileId).toBeTruthy();
    expect(msg.update.length).toBeGreaterThan(2);

    // Decoding the broadcast on a fresh doc should reproduce the file's
    // initial text — that's what a real plugin client would do.
    const replica = new Y.Doc();
    Y.applyUpdate(replica, Uint8Array.from(msg.update));
    expect(replica.getText(TEXT_KEY).toString()).toBe('born in cli');
    replica.destroy();
  });
});

describe('yjs:update', () => {
  it('persists update and broadcasts to room', async () => {
    const { userId, plainKey } = await bootstrapUserAndKey('Y');
    const project = await createProject(userId);
    const file = await testPrisma.vaultFile.create({
      data: {
        projectId: project.id,
        path: 'live.md',
        fileType: 'TEXT',
        contentHash: 'init',
        size: BigInt(0),
      },
    });

    const peerA = connect(plainKey);
    const peerB = connect(plainKey);
    await Promise.all([
      new Promise<void>((r) => peerA.on('connect', () => r())),
      new Promise<void>((r) => peerB.on('connect', () => r())),
    ]);
    await emitWithAck(peerA, 'project:join', { projectId: project.id });
    await emitWithAck(peerB, 'project:join', { projectId: project.id });

    // Build a Yjs update that inserts text.
    const doc = new Y.Doc();
    doc.getText(TEXT_KEY).insert(0, 'Hello CRDT');
    const update = Y.encodeStateAsUpdate(doc);
    doc.destroy();

    const broadcast = new Promise<{ fileId: string; update: number[] }>((resolve) => {
      peerB.once('yjs:update', (data) => resolve(data as never));
    });

    const ack = await emitWithAck<{ ok: true; changed: boolean }>(peerA, 'yjs:update', {
      projectId: project.id,
      fileId: file.id,
      update: Array.from(update),
    });
    expect(ack.ok).toBe(true);
    expect(ack.changed).toBe(true);

    const broadcastMsg = await broadcast;
    expect(broadcastMsg.fileId).toBe(file.id);
    expect(broadcastMsg.update.length).toBe(update.length);

    // Server-persisted Y.Doc must match.
    const stored = await testPrisma.yjsDocument.findUnique({ where: { fileId: file.id } });
    expect(stored).not.toBeNull();
    const reload = new Y.Doc();
    Y.applyUpdate(reload, new Uint8Array(stored!.state));
    expect(reload.getText(TEXT_KEY).toString()).toBe('Hello CRDT');
    reload.destroy();
  });
});
