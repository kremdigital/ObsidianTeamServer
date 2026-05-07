import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { resetDatabase, testPrisma } from './db';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('User', () => {
  it('creates a user with default role USER and language ru', async () => {
    const user = await testPrisma.user.create({
      data: {
        email: 'alice@example.com',
        passwordHash: 'hash',
        name: 'Alice',
      },
    });

    expect(user.id).toBeTruthy();
    expect(user.role).toBe('USER');
    expect(user.language).toBe('ru');
    expect(user.emailVerified).toBeNull();
  });

  it('rejects duplicate emails (unique index)', async () => {
    await testPrisma.user.create({
      data: { email: 'dup@example.com', passwordHash: 'h', name: 'A' },
    });

    await expect(
      testPrisma.user.create({
        data: { email: 'dup@example.com', passwordHash: 'h', name: 'B' },
      }),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it('cascades to refresh tokens, api keys and verification tokens on user delete', async () => {
    const user = await testPrisma.user.create({
      data: {
        email: 'cascade@example.com',
        passwordHash: 'h',
        name: 'C',
        refreshTokens: {
          create: { tokenHash: 'rt-1', expiresAt: new Date(Date.now() + 86_400_000) },
        },
        apiKeys: {
          create: { name: 'cli', keyHash: 'kh-1', keyPrefix: 'osync_pref' },
        },
        emailVerificationTokens: {
          create: { token: 'evt-1', expiresAt: new Date(Date.now() + 86_400_000) },
        },
      },
    });

    await testPrisma.user.delete({ where: { id: user.id } });

    expect(await testPrisma.refreshToken.count()).toBe(0);
    expect(await testPrisma.apiKey.count()).toBe(0);
    expect(await testPrisma.emailVerificationToken.count()).toBe(0);
  });
});

describe('Project & ProjectMember', () => {
  it('rejects deleting a user that owns a project (Restrict)', async () => {
    const owner = await testPrisma.user.create({
      data: { email: 'owner@example.com', passwordHash: 'h', name: 'Owner' },
    });
    await testPrisma.project.create({
      data: { slug: 'p1', name: 'P1', ownerId: owner.id },
    });

    await expect(testPrisma.user.delete({ where: { id: owner.id } })).rejects.toThrow(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it('enforces unique (projectId, userId) on ProjectMember', async () => {
    const owner = await testPrisma.user.create({
      data: { email: 'o2@example.com', passwordHash: 'h', name: 'O2' },
    });
    const member = await testPrisma.user.create({
      data: { email: 'm2@example.com', passwordHash: 'h', name: 'M2' },
    });
    const project = await testPrisma.project.create({
      data: { slug: 'p2', name: 'P2', ownerId: owner.id },
    });

    await testPrisma.projectMember.create({
      data: { projectId: project.id, userId: member.id, role: 'EDITOR' },
    });

    await expect(
      testPrisma.projectMember.create({
        data: { projectId: project.id, userId: member.id, role: 'VIEWER' },
      }),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it('cascades members, invitations, files, operations on project delete', async () => {
    const owner = await testPrisma.user.create({
      data: { email: 'o3@example.com', passwordHash: 'h', name: 'O3' },
    });
    const member = await testPrisma.user.create({
      data: { email: 'm3@example.com', passwordHash: 'h', name: 'M3' },
    });
    const project = await testPrisma.project.create({
      data: {
        slug: 'p3',
        name: 'P3',
        ownerId: owner.id,
        members: { create: { userId: member.id, role: 'EDITOR' } },
        invitations: {
          create: {
            email: 'invitee@example.com',
            role: 'VIEWER',
            token: 'inv-1',
            expiresAt: new Date(Date.now() + 86_400_000),
            invitedById: owner.id,
          },
        },
        files: {
          create: {
            path: 'note.md',
            fileType: 'TEXT',
            contentHash: 'sha256:abc',
            size: BigInt(10),
          },
        },
        operations: {
          create: {
            opType: 'CREATE',
            filePath: 'note.md',
            authorId: owner.id,
            vectorClock: { [owner.id]: 1 },
            payload: { contentHash: 'sha256:abc' },
          },
        },
      },
    });

    await testPrisma.project.delete({ where: { id: project.id } });

    expect(await testPrisma.projectMember.count()).toBe(0);
    expect(await testPrisma.projectInvitation.count()).toBe(0);
    expect(await testPrisma.vaultFile.count()).toBe(0);
    expect(await testPrisma.operationLog.count()).toBe(0);
  });
});

describe('VaultFile', () => {
  it('cascades to YjsDocument and FileVersion on file delete', async () => {
    const owner = await testPrisma.user.create({
      data: { email: 'o4@example.com', passwordHash: 'h', name: 'O4' },
    });
    const project = await testPrisma.project.create({
      data: { slug: 'p4', name: 'P4', ownerId: owner.id },
    });
    const file = await testPrisma.vaultFile.create({
      data: {
        projectId: project.id,
        path: 'doc.md',
        fileType: 'TEXT',
        contentHash: 'sha256:f1',
        size: BigInt(20),
        yjsDocument: {
          create: { state: Buffer.from([1, 2, 3]), stateVector: Buffer.from([0]) },
        },
        versions: {
          create: {
            versionNumber: 1,
            contentHash: 'sha256:f1',
            snapshotPath: '.versions/x/1.snapshot',
            authorId: owner.id,
          },
        },
      },
    });

    await testPrisma.vaultFile.delete({ where: { id: file.id } });

    expect(await testPrisma.yjsDocument.count()).toBe(0);
    expect(await testPrisma.fileVersion.count()).toBe(0);
  });

  it('enforces unique (projectId, path)', async () => {
    const owner = await testPrisma.user.create({
      data: { email: 'o5@example.com', passwordHash: 'h', name: 'O5' },
    });
    const project = await testPrisma.project.create({
      data: { slug: 'p5', name: 'P5', ownerId: owner.id },
    });

    await testPrisma.vaultFile.create({
      data: {
        projectId: project.id,
        path: 'same.md',
        fileType: 'TEXT',
        contentHash: 'h1',
        size: BigInt(1),
      },
    });

    await expect(
      testPrisma.vaultFile.create({
        data: {
          projectId: project.id,
          path: 'same.md',
          fileType: 'TEXT',
          contentHash: 'h2',
          size: BigInt(2),
        },
      }),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it('preserves FileVersion when its author is deleted (SetNull)', async () => {
    const owner = await testPrisma.user.create({
      data: { email: 'o6@example.com', passwordHash: 'h', name: 'O6' },
    });
    const author = await testPrisma.user.create({
      data: { email: 'a6@example.com', passwordHash: 'h', name: 'A6' },
    });
    const project = await testPrisma.project.create({
      data: { slug: 'p6', name: 'P6', ownerId: owner.id },
    });
    const file = await testPrisma.vaultFile.create({
      data: {
        projectId: project.id,
        path: 'v.md',
        fileType: 'TEXT',
        contentHash: 'vh',
        size: BigInt(5),
      },
    });
    const version = await testPrisma.fileVersion.create({
      data: {
        fileId: file.id,
        versionNumber: 1,
        contentHash: 'vh',
        snapshotPath: '.v/1',
        authorId: author.id,
      },
    });

    await testPrisma.user.delete({ where: { id: author.id } });

    const reloaded = await testPrisma.fileVersion.findUnique({ where: { id: version.id } });
    expect(reloaded?.authorId).toBeNull();
  });
});

describe('ServerConfig', () => {
  it('uses key as primary key and stores arbitrary JSON', async () => {
    await testPrisma.serverConfig.create({
      data: { key: 'demo', value: { nested: { ok: true }, count: 7 } },
    });

    const row = await testPrisma.serverConfig.findUnique({ where: { key: 'demo' } });
    expect(row?.value).toEqual({ nested: { ok: true }, count: 7 });
  });
});
