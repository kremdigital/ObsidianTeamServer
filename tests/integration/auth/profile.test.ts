import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATCH } from '@/app/api/auth/me/route';
import * as session from '@/lib/auth/session';
import { hashPassword } from '@/lib/auth/password';
import { resetDatabase, testPrisma } from '../db';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
  vi.restoreAllMocks();
});

async function seedUser(
  overrides: Partial<{ email: string; name: string; language: string }> = {},
) {
  return testPrisma.user.create({
    data: {
      email: overrides.email ?? 'profile@example.com',
      passwordHash: await hashPassword('Strong1!Pass'),
      name: overrides.name ?? 'Original Name',
      language: overrides.language ?? 'ru',
      emailVerified: new Date(),
    },
  });
}

function mockSession(userId: string) {
  vi.spyOn(session, 'getCurrentUser').mockResolvedValue({
    id: userId,
    email: 'profile@example.com',
    name: 'Original Name',
    role: 'USER',
    emailVerified: new Date(),
    language: 'ru',
  });
}

function patchRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/auth/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/auth/me', () => {
  it('updates the user name and records an audit log', async () => {
    const user = await seedUser();
    mockSession(user.id);

    const res = await PATCH(patchRequest({ name: 'New Name' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.name).toBe('New Name');

    const reloaded = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(reloaded.name).toBe('New Name');

    const audits = await testPrisma.auditLog.findMany({ where: { userId: user.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('auth.profile.update');
  });

  it('rejects an email that is already taken by another user', async () => {
    const owner = await seedUser({ email: 'taken@example.com', name: 'Taken' });
    const me = await seedUser({ email: 'me@example.com' });
    mockSession(me.id);
    // Mock the session's email field to match the real seeded value.
    vi.spyOn(session, 'getCurrentUser').mockResolvedValue({
      id: me.id,
      email: 'me@example.com',
      name: 'Original Name',
      role: 'USER',
      emailVerified: new Date(),
      language: 'ru',
    });

    const res = await PATCH(patchRequest({ email: owner.email }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('email_taken');

    // Original email untouched on the row.
    const reloaded = await testPrisma.user.findUniqueOrThrow({ where: { id: me.id } });
    expect(reloaded.email).toBe('me@example.com');
  });

  it('resets emailVerified when the email actually changes', async () => {
    const user = await seedUser();
    mockSession(user.id);

    const res = await PATCH(patchRequest({ email: 'new@example.com' }));
    expect(res.status).toBe(200);

    const reloaded = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(reloaded.email).toBe('new@example.com');
    expect(reloaded.emailVerified).toBeNull();
  });

  it('does not reset emailVerified when the email payload matches the current value', async () => {
    const user = await seedUser();
    mockSession(user.id);
    const before = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } });

    const res = await PATCH(patchRequest({ email: before.email, name: 'New Name' }));
    expect(res.status).toBe(200);

    const after = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.emailVerified?.getTime()).toBe(before.emailVerified?.getTime());
    expect(after.name).toBe('New Name');
  });

  it('returns 401 without a session', async () => {
    vi.spyOn(session, 'getCurrentUser').mockResolvedValue(null);
    const res = await PATCH(patchRequest({ name: 'X' }));
    expect(res.status).toBe(401);
  });
});
