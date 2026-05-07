import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/auth/verify-email/route';
import { resetDatabase, testPrisma } from '../db';
import { makeRequest } from './helpers';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('POST /api/auth/verify-email', () => {
  it('marks user as verified and deletes the token on success', async () => {
    const user = await testPrisma.user.create({
      data: {
        email: 'verify@example.com',
        passwordHash: 'h',
        name: 'V',
        emailVerificationTokens: {
          create: { token: 'verify-1', expiresAt: new Date(Date.now() + 60_000) },
        },
      },
    });

    const res = await POST(makeRequest('/api/auth/verify-email', { token: 'verify-1' }));
    expect(res.status).toBe(200);

    const updated = await testPrisma.user.findUnique({ where: { id: user.id } });
    expect(updated?.emailVerified).not.toBeNull();

    expect(await testPrisma.emailVerificationToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it('rejects an unknown token', async () => {
    const res = await POST(makeRequest('/api/auth/verify-email', { token: 'does-not-exist' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_token');
  });

  it('rejects an expired token', async () => {
    await testPrisma.user.create({
      data: {
        email: 'exp@example.com',
        passwordHash: 'h',
        name: 'E',
        emailVerificationTokens: {
          create: { token: 'expired-1', expiresAt: new Date(Date.now() - 1000) },
        },
      },
    });

    const res = await POST(makeRequest('/api/auth/verify-email', { token: 'expired-1' }));
    expect(res.status).toBe(400);
  });
});
