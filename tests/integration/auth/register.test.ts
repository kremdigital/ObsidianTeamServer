import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/auth/register/route';
import { testPrisma } from '../db';
import {
  clearSentMails,
  getSentMails,
  makeRequest,
  resetAndConfigureRegistration,
} from './helpers';

beforeEach(async () => {
  await resetAndConfigureRegistration(true);
  clearSentMails();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('POST /api/auth/register', () => {
  it('creates a user and sends a verification email when registration is open', async () => {
    const res = await POST(
      makeRequest('/api/auth/register', {
        email: 'NewUser@Example.com',
        password: 'StrongPass1!',
        name: 'New User',
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.email).toBe('newuser@example.com');

    const user = await testPrisma.user.findUnique({ where: { email: 'newuser@example.com' } });
    expect(user).not.toBeNull();
    expect(user?.role).toBe('USER');
    expect(user?.emailVerified).toBeNull();

    const token = await testPrisma.emailVerificationToken.findFirst({
      where: { userId: user!.id },
    });
    expect(token).not.toBeNull();
    expect(token!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const mails = getSentMails();
    expect(mails).toHaveLength(1);
    expect(mails[0]?.to).toBe('newuser@example.com');
    expect(mails[0]?.subject).toMatch(/Подтверждение/);
  });

  it('rejects when email is already registered', async () => {
    await testPrisma.user.create({
      data: { email: 'taken@example.com', passwordHash: 'h', name: 'X' },
    });

    const res = await POST(
      makeRequest('/api/auth/register', {
        email: 'taken@example.com',
        password: 'StrongPass1!',
        name: 'Y',
      }),
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('email_taken');
  });

  it('rejects on weak password', async () => {
    const res = await POST(
      makeRequest('/api/auth/register', {
        email: 'weak@example.com',
        password: '123',
        name: 'Weak',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('validation_error');
    expect(body.error.fields).toHaveProperty('password');
  });

  it('returns 403 when registration is closed and no invite is provided', async () => {
    await resetAndConfigureRegistration(false);
    const res = await POST(
      makeRequest('/api/auth/register', {
        email: 'closed@example.com',
        password: 'StrongPass1!',
        name: 'Closed',
      }),
    );

    expect(res.status).toBe(403);
  });

  it('accepts invite token when registration is closed', async () => {
    await resetAndConfigureRegistration(false);

    const inviter = await testPrisma.user.create({
      data: {
        email: 'inviter@example.com',
        passwordHash: 'h',
        name: 'Inviter',
        role: 'SUPERADMIN',
      },
    });

    const invite = await testPrisma.serverInvitation.create({
      data: {
        email: 'invitee@example.com',
        token: 'invite-token-123',
        invitedById: inviter.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const res = await POST(
      makeRequest('/api/auth/register', {
        email: 'invitee@example.com',
        password: 'StrongPass1!',
        name: 'Invitee',
        inviteToken: invite.token,
      }),
    );

    expect(res.status).toBe(201);

    const updatedInvite = await testPrisma.serverInvitation.findUnique({
      where: { id: invite.id },
    });
    expect(updatedInvite?.acceptedAt).not.toBeNull();
  });

  it('rejects invite when email does not match', async () => {
    await resetAndConfigureRegistration(false);
    const inviter = await testPrisma.user.create({
      data: { email: 'i2@example.com', passwordHash: 'h', name: 'I', role: 'SUPERADMIN' },
    });
    await testPrisma.serverInvitation.create({
      data: {
        email: 'expected@example.com',
        token: 'invite-token-456',
        invitedById: inviter.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const res = await POST(
      makeRequest('/api/auth/register', {
        email: 'wrong@example.com',
        password: 'StrongPass1!',
        name: 'Wrong',
        inviteToken: 'invite-token-456',
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invite_email_mismatch');
  });
});
