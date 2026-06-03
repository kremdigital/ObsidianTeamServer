import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/admin/users/route';
import * as session from '@/lib/auth/session';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { resetDatabase, testPrisma } from '../db';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
  vi.restoreAllMocks();
});

/** Seeds a real user row and points the mocked session at it. */
async function seedSession(role: 'USER' | 'SUPERADMIN') {
  const user = await testPrisma.user.create({
    data: {
      email: `${role.toLowerCase()}@example.com`,
      passwordHash: await hashPassword('Strong1!Pass'),
      name: role,
      language: 'ru',
      role,
      emailVerified: new Date(),
    },
  });
  vi.spyOn(session, 'getCurrentUser').mockResolvedValue({
    id: user.id,
    email: user.email,
    name: user.name,
    role,
    emailVerified: user.emailVerified,
    language: user.language,
  });
  return user;
}

function postRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/admin/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/users', () => {
  it('lets a superadmin create a login-ready user and records an audit log', async () => {
    const admin = await seedSession('SUPERADMIN');

    const res = await POST(
      postRequest({
        name: 'Made By Admin',
        email: 'New.User@Example.com',
        password: 'AdminSetPass1!',
        role: 'USER',
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.email).toBe('new.user@example.com'); // normalized
    expect(body.user.role).toBe('USER');

    const row = await testPrisma.user.findUniqueOrThrow({ where: { id: body.user.id } });
    // Admin-created users are pre-verified so they can log in immediately.
    expect(row.emailVerified).not.toBeNull();
    // The admin-set password actually authenticates.
    expect(await verifyPassword('AdminSetPass1!', row.passwordHash)).toBe(true);

    const audits = await testPrisma.auditLog.findMany({ where: { action: 'admin.user.create' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.userId).toBe(admin.id);
    expect(audits[0]?.entityId).toBe(body.user.id);
  });

  it('defaults the role to USER and supports creating a SUPERADMIN', async () => {
    await seedSession('SUPERADMIN');

    const def = await POST(
      postRequest({ name: 'No Role', email: 'norole@example.com', password: 'AdminSetPass1!' }),
    );
    expect(def.status).toBe(201);
    expect((await def.json()).user.role).toBe('USER');

    const sa = await POST(
      postRequest({
        name: 'Second Admin',
        email: 'admin2@example.com',
        password: 'AdminSetPass1!',
        role: 'SUPERADMIN',
      }),
    );
    expect(sa.status).toBe(201);
    expect((await sa.json()).user.role).toBe('SUPERADMIN');
  });

  it('rejects a duplicate email with 409', async () => {
    await seedSession('SUPERADMIN');
    const payload = {
      name: 'Dup',
      email: 'dup@example.com',
      password: 'AdminSetPass1!',
      role: 'USER',
    };
    expect((await POST(postRequest(payload))).status).toBe(201);
    const second = await POST(postRequest(payload));
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe('email_taken');
  });

  it('rejects a too-short password with a validation error', async () => {
    await seedSession('SUPERADMIN');
    const res = await POST(
      postRequest({ name: 'Weak', email: 'weak@example.com', password: 'short' }),
    );
    expect(res.status).toBe(400);
  });

  it('forbids a non-superadmin from creating users', async () => {
    await seedSession('USER');
    const res = await POST(
      postRequest({ name: 'Nope', email: 'nope@example.com', password: 'AdminSetPass1!' }),
    );
    expect(res.status).toBe(403);
    expect(await testPrisma.user.findUnique({ where: { email: 'nope@example.com' } })).toBeNull();
  });
});
