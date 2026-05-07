import { type APIRequestContext, expect, test } from '@playwright/test';
import { e2ePrisma, resetE2eDatabase } from './helpers/db';

test.describe.configure({ mode: 'serial' });

test.beforeEach(async () => {
  await resetE2eDatabase();
  await e2ePrisma.serverConfig.upsert({
    where: { key: 'openRegistration' },
    update: { value: true },
    create: { key: 'openRegistration', value: true },
  });
});

test.afterAll(async () => {
  await e2ePrisma.$disconnect();
});

async function bootstrap(
  request: APIRequestContext,
  name: string,
  role: 'USER' | 'SUPERADMIN' = 'USER',
) {
  const email = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = 'StrongPass1!';
  await request.post('/api/auth/register', { data: { email, password, name } });
  const u = await e2ePrisma.user.findUnique({ where: { email: email.toLowerCase() } });
  await e2ePrisma.user.update({
    where: { id: u!.id },
    data: { emailVerified: new Date(), role },
  });
  await request.post('/api/auth/login', { data: { email, password } });
  return { id: u!.id, email };
}

test('non-superadmin cannot access admin API', async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  await bootstrap(ctx, 'regular');

  const usersRes = await ctx.get('/api/admin/users');
  expect(usersRes.status()).toBe(403);

  const settingsRes = await ctx.get('/api/admin/settings');
  expect(settingsRes.status()).toBe(403);

  await ctx.dispose();
});

test('superadmin can list users, change role, block, and audit log records it', async ({
  playwright,
}) => {
  const adminCtx = await playwright.request.newContext();
  const targetCtx = await playwright.request.newContext();

  const admin = await bootstrap(adminCtx, 'super', 'SUPERADMIN');
  const target = await bootstrap(targetCtx, 'target', 'USER');

  // List users includes both.
  const list = await adminCtx.get('/api/admin/users');
  expect(list.status()).toBe(200);
  const listBody = (await list.json()) as { users: Array<{ id: string }> };
  expect(listBody.users.some((u) => u.id === admin.id)).toBe(true);
  expect(listBody.users.some((u) => u.id === target.id)).toBe(true);

  // Promote target to SUPERADMIN.
  const patch = await adminCtx.patch(`/api/admin/users/${target.id}`, {
    data: { role: 'SUPERADMIN' },
  });
  expect(patch.status()).toBe(200);
  const refreshed = await e2ePrisma.user.findUnique({ where: { id: target.id } });
  expect(refreshed?.role).toBe('SUPERADMIN');

  // Block target.
  const block = await adminCtx.patch(`/api/admin/users/${target.id}`, {
    data: { disabled: true },
  });
  expect(block.status()).toBe(200);
  const blocked = await e2ePrisma.user.findUnique({ where: { id: target.id } });
  expect(blocked?.disabledAt).not.toBeNull();
  // Refresh tokens of the blocked user must have been revoked.
  const activeRefresh = await e2ePrisma.refreshToken.findFirst({
    where: { userId: target.id, revokedAt: null },
  });
  expect(activeRefresh).toBeNull();

  // Audit log contains both admin actions.
  const auditRes = await adminCtx.get('/api/admin/audit-log?action=admin.user');
  const audit = (await auditRes.json()) as { entries: Array<{ action: string; entityId: string }> };
  const actions = audit.entries.map((e) => e.action);
  expect(actions).toContain('admin.user.update');
  // At least 2 update entries should exist (role + disabled).
  expect(actions.filter((a) => a === 'admin.user.update').length).toBeGreaterThanOrEqual(2);
  // entityId must match target.
  expect(audit.entries.every((e) => e.entityId === target.id)).toBe(true);

  await adminCtx.dispose();
  await targetCtx.dispose();
});

test('superadmin can update server settings', async ({ playwright }) => {
  const adminCtx = await playwright.request.newContext();
  await bootstrap(adminCtx, 'settings-admin', 'SUPERADMIN');

  const update = await adminCtx.patch('/api/admin/settings', {
    data: { openRegistration: false, smtpEnabled: true },
  });
  expect(update.status()).toBe(200);

  const get = await adminCtx.get('/api/admin/settings');
  const { settings } = (await get.json()) as {
    settings: { openRegistration?: boolean; smtpEnabled?: boolean };
  };
  expect(settings.openRegistration).toBe(false);
  expect(settings.smtpEnabled).toBe(true);

  await adminCtx.dispose();
});

test('superadmin can create and revoke a server invitation', async ({ playwright }) => {
  const adminCtx = await playwright.request.newContext();
  await bootstrap(adminCtx, 'inv-admin', 'SUPERADMIN');

  const create = await adminCtx.post('/api/admin/invitations', {
    data: { email: `invitee-${Date.now()}@example.com` },
  });
  expect(create.status()).toBe(201);
  const { invitation, url } = (await create.json()) as {
    invitation: { id: string; token: string };
    url: string;
  };
  expect(url).toContain(invitation.token);

  const revoke = await adminCtx.delete(`/api/admin/invitations/${invitation.id}`);
  expect(revoke.status()).toBe(200);

  const list = await adminCtx.get('/api/admin/invitations');
  const body = (await list.json()) as { invitations: Array<{ id: string }> };
  expect(body.invitations.some((i) => i.id === invitation.id)).toBe(false);

  await adminCtx.dispose();
});
