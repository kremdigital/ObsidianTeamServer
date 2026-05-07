import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as forgotPassword } from '@/app/api/auth/forgot-password/route';
import { POST as resetPassword } from '@/app/api/auth/reset-password/route';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { resetDatabase, testPrisma } from '../db';
import { clearSentMails, getSentMails, makeRequest } from './helpers';

beforeEach(async () => {
  await resetDatabase();
  clearSentMails();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('POST /api/auth/forgot-password', () => {
  it('creates a token and sends email when user exists', async () => {
    const user = await testPrisma.user.create({
      data: { email: 'fp@example.com', passwordHash: 'h', name: 'FP' },
    });

    const res = await forgotPassword(
      makeRequest('/api/auth/forgot-password', { email: 'fp@example.com' }),
    );
    expect(res.status).toBe(200);

    const tokens = await testPrisma.passwordResetToken.findMany({ where: { userId: user.id } });
    expect(tokens).toHaveLength(1);
    expect(getSentMails()).toHaveLength(1);
    expect(getSentMails()[0]?.subject).toMatch(/Восстановление/);
  });

  it('returns 200 even when user does not exist (no enumeration leak)', async () => {
    const res = await forgotPassword(
      makeRequest('/api/auth/forgot-password', { email: 'ghost@example.com' }),
    );
    expect(res.status).toBe(200);
    expect(await testPrisma.passwordResetToken.count()).toBe(0);
    expect(getSentMails()).toHaveLength(0);
  });
});

describe('POST /api/auth/reset-password', () => {
  it('updates password, marks token used, revokes refresh tokens', async () => {
    const oldHash = await hashPassword('OldPass1!');
    const user = await testPrisma.user.create({
      data: {
        email: 'rp@example.com',
        passwordHash: oldHash,
        name: 'RP',
        passwordResetTokens: {
          create: { token: 'reset-1', expiresAt: new Date(Date.now() + 60_000) },
        },
        refreshTokens: {
          create: { tokenHash: 'rh-1', expiresAt: new Date(Date.now() + 86_400_000) },
        },
      },
    });

    const res = await resetPassword(
      makeRequest('/api/auth/reset-password', {
        token: 'reset-1',
        password: 'NewPass2@',
      }),
    );
    expect(res.status).toBe(200);

    const updated = await testPrisma.user.findUnique({ where: { id: user.id } });
    expect(await verifyPassword('NewPass2@', updated!.passwordHash)).toBe(true);
    expect(await verifyPassword('OldPass1!', updated!.passwordHash)).toBe(false);

    const tokenRow = await testPrisma.passwordResetToken.findUnique({
      where: { token: 'reset-1' },
    });
    expect(tokenRow?.usedAt).not.toBeNull();

    const activeRefresh = await testPrisma.refreshToken.findFirst({
      where: { userId: user.id, revokedAt: null },
    });
    expect(activeRefresh).toBeNull();
  });

  it('rejects an already-used token', async () => {
    const oldHash = await hashPassword('OldPass1!');
    await testPrisma.user.create({
      data: {
        email: 'used@example.com',
        passwordHash: oldHash,
        name: 'U',
        passwordResetTokens: {
          create: {
            token: 'used-1',
            expiresAt: new Date(Date.now() + 60_000),
            usedAt: new Date(),
          },
        },
      },
    });

    const res = await resetPassword(
      makeRequest('/api/auth/reset-password', { token: 'used-1', password: 'NewPass2@' }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects expired token', async () => {
    const oldHash = await hashPassword('OldPass1!');
    await testPrisma.user.create({
      data: {
        email: 'exp@example.com',
        passwordHash: oldHash,
        name: 'E',
        passwordResetTokens: {
          create: { token: 'exp-1', expiresAt: new Date(Date.now() - 1000) },
        },
      },
    });

    const res = await resetPassword(
      makeRequest('/api/auth/reset-password', { token: 'exp-1', password: 'NewPass2@' }),
    );
    expect(res.status).toBe(400);
  });
});
