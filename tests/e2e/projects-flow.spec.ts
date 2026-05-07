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

async function bootstrapVerifiedUser(
  request: APIRequestContext,
  email: string,
  password: string,
  name: string,
) {
  await request.post('/api/auth/register', { data: { email, password, name } });
  const u = await e2ePrisma.user.findUnique({ where: { email: email.toLowerCase() } });
  await e2ePrisma.user.update({
    where: { id: u!.id },
    data: { emailVerified: new Date() },
  });
  await request.post('/api/auth/login', { data: { email, password } });
  return u!.id;
}

test('owner creates a project and invites a second user by email', async ({
  playwright,
  request,
}) => {
  // Bootstrap two separate API contexts so they hold independent cookies.
  const ownerCtx = await playwright.request.newContext();
  const inviteeCtx = await playwright.request.newContext();

  const ownerEmail = `owner-${Date.now()}@example.com`;
  const inviteeEmail = `mate-${Date.now()}@example.com`;
  const password = 'StrongPass1!';

  await bootstrapVerifiedUser(ownerCtx, ownerEmail, password, 'Owner');
  await bootstrapVerifiedUser(inviteeCtx, inviteeEmail, password, 'Mate');

  // Owner creates a project.
  const create = await ownerCtx.post('/api/projects', {
    data: { name: 'Демо проект', iconEmoji: '🚀' },
  });
  expect(create.status()).toBe(201);
  const { project } = (await create.json()) as { project: { id: string; slug: string } };
  expect(project.slug).toMatch(/^demo-proekt/);

  // Owner is automatically a member with role ADMIN.
  const owner = await e2ePrisma.user.findUnique({ where: { email: ownerEmail.toLowerCase() } });
  const ownerMembership = await e2ePrisma.projectMember.findFirst({
    where: { projectId: project.id, userId: owner!.id },
  });
  expect(ownerMembership?.role).toBe('ADMIN');

  // Owner invites by email.
  const invite = await ownerCtx.post(`/api/projects/${project.id}/invitations`, {
    data: { email: inviteeEmail, role: 'EDITOR' },
  });
  expect(invite.status()).toBe(201);
  const { invitation } = (await invite.json()) as { invitation: { token: string } };

  // Stranger (invitee with wrong account) cannot view the project yet.
  const beforeAccept = await inviteeCtx.get(`/api/projects/${project.id}`);
  expect(beforeAccept.status()).toBe(403);

  // Invitee accepts via API.
  const accept = await inviteeCtx.post('/api/auth/accept-invite', {
    data: { token: invitation.token },
  });
  expect(accept.status()).toBe(200);

  // Now invitee can view and the project shows up in their list.
  const afterAccept = await inviteeCtx.get(`/api/projects/${project.id}`);
  expect(afterAccept.status()).toBe(200);
  const myProjects = await inviteeCtx.get('/api/projects');
  const list = (await myProjects.json()) as { projects: Array<{ id: string }> };
  expect(list.projects.some((p) => p.id === project.id)).toBe(true);

  // Permissions: invitee (EDITOR) can NOT manage members.
  const cannotInvite = await inviteeCtx.post(`/api/projects/${project.id}/invitations`, {
    data: { email: 'someone@example.com', role: 'VIEWER' },
  });
  expect(cannotInvite.status()).toBe(403);

  // Permissions: invitee (EDITOR) can NOT delete the project.
  const cannotDelete = await inviteeCtx.delete(`/api/projects/${project.id}`);
  expect(cannotDelete.status()).toBe(403);

  // Owner deletes — succeeds.
  const ownerDelete = await ownerCtx.delete(`/api/projects/${project.id}`);
  expect(ownerDelete.status()).toBe(200);

  await ownerCtx.dispose();
  await inviteeCtx.dispose();

  // Touch the parent `request` parameter so eslint doesn't flag it as unused.
  void request;
});

test('share-link invitation: any logged-in user can join', async ({ playwright }) => {
  const ownerCtx = await playwright.request.newContext();
  const otherCtx = await playwright.request.newContext();

  const password = 'StrongPass1!';
  await bootstrapVerifiedUser(ownerCtx, `share-o-${Date.now()}@example.com`, password, 'O');
  await bootstrapVerifiedUser(otherCtx, `share-x-${Date.now()}@example.com`, password, 'X');

  const { project } = (await (
    await ownerCtx.post('/api/projects', { data: { name: 'Шара' } })
  ).json()) as { project: { id: string } };

  const { invitation } = (await (
    await ownerCtx.post(`/api/projects/${project.id}/invitations`, {
      data: { role: 'VIEWER', shareLink: true },
    })
  ).json()) as { invitation: { token: string; email: string | null } };
  expect(invitation.email).toBeNull();

  const accept = await otherCtx.post('/api/auth/accept-invite', {
    data: { token: invitation.token },
  });
  expect(accept.status()).toBe(200);

  const role = await e2ePrisma.projectMember.findFirst({
    where: { projectId: project.id },
    orderBy: { addedAt: 'desc' },
  });
  expect(role?.role).toBe('VIEWER');

  await ownerCtx.dispose();
  await otherCtx.dispose();
});

test('email-bound invitation rejects mismatched email', async ({ playwright }) => {
  const ownerCtx = await playwright.request.newContext();
  const wrongCtx = await playwright.request.newContext();

  const password = 'StrongPass1!';
  await bootstrapVerifiedUser(ownerCtx, `eo-${Date.now()}@example.com`, password, 'O');
  await bootstrapVerifiedUser(wrongCtx, `wrong-${Date.now()}@example.com`, password, 'W');

  const { project } = (await (
    await ownerCtx.post('/api/projects', { data: { name: 'Email-only' } })
  ).json()) as { project: { id: string } };

  const targetEmail = `target-${Date.now()}@example.com`;
  const { invitation } = (await (
    await ownerCtx.post(`/api/projects/${project.id}/invitations`, {
      data: { email: targetEmail, role: 'VIEWER' },
    })
  ).json()) as { invitation: { token: string } };

  const accept = await wrongCtx.post('/api/auth/accept-invite', {
    data: { token: invitation.token },
  });
  expect(accept.status()).toBe(400);
  const body = (await accept.json()) as { error: { code: string } };
  expect(body.error.code).toBe('invite_email_mismatch');

  await ownerCtx.dispose();
  await wrongCtx.dispose();
});
