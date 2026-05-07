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

async function bootstrap(request: APIRequestContext, name: string) {
  const email = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = 'StrongPass1!';
  await request.post('/api/auth/register', { data: { email, password, name } });
  const u = await e2ePrisma.user.findUnique({ where: { email: email.toLowerCase() } });
  await e2ePrisma.user.update({ where: { id: u!.id }, data: { emailVerified: new Date() } });
  await request.post('/api/auth/login', { data: { email, password } });
  return { user: u!, email };
}

test('upload, download, version, move, delete a file via session auth', async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  await bootstrap(ctx, 'owner');

  const { project } = (await (
    await ctx.post('/api/projects', { data: { name: 'Files Demo' } })
  ).json()) as { project: { id: string } };

  // Upload via multipart.
  const upload = await ctx.post(`/api/projects/${project.id}/files`, {
    multipart: {
      path: 'notes/welcome.md',
      file: { name: 'welcome.md', mimeType: 'text/markdown', buffer: Buffer.from('# Hello\n') },
    },
  });
  expect(upload.status()).toBe(201);
  const { file } = (await upload.json()) as {
    file: { id: string; path: string; contentHash: string };
  };
  expect(file.path).toBe('notes/welcome.md');
  expect(file.contentHash).toMatch(/^[0-9a-f]{64}$/);

  // List shows the file.
  const list = (await (await ctx.get(`/api/projects/${project.id}/files`)).json()) as {
    files: Array<{ id: string; path: string }>;
  };
  expect(list.files).toHaveLength(1);
  expect(list.files[0]?.path).toBe('notes/welcome.md');

  // Download.
  const download = await ctx.get(`/api/projects/${project.id}/files/${file.id}`);
  expect(download.status()).toBe(200);
  expect(await download.text()).toBe('# Hello\n');

  // Update content (PUT raw body) — should produce a 2nd version.
  const update = await ctx.put(`/api/projects/${project.id}/files/${file.id}`, {
    data: '# Hello updated\n',
  });
  expect(update.status()).toBe(200);

  const versionsRes = await ctx.get(`/api/projects/${project.id}/files/${file.id}/versions`);
  const versions = (await versionsRes.json()) as {
    versions: Array<{ id: string; versionNumber: number }>;
  };
  expect(versions.versions).toHaveLength(2);
  expect(versions.versions[0]?.versionNumber).toBe(2);

  // Read v1 — should still contain the original content.
  const v1 = versions.versions[1]!;
  const v1Body = await ctx.get(`/api/projects/${project.id}/files/${file.id}/versions/${v1.id}`);
  expect(v1Body.status()).toBe(200);
  expect(await v1Body.text()).toBe('# Hello\n');

  // Move (PATCH on the file resource) — uses /move semantics via PATCH.
  const move = await ctx.patch(`/api/projects/${project.id}/files/${file.id}`, {
    data: { newPath: 'archive/welcome.md' },
  });
  expect(move.status()).toBe(200);

  // Delete (soft).
  const del = await ctx.delete(`/api/projects/${project.id}/files/${file.id}`);
  expect(del.status()).toBe(200);

  const afterDelete = (await (await ctx.get(`/api/projects/${project.id}/files`)).json()) as {
    files: unknown[];
  };
  expect(afterDelete.files).toHaveLength(0);

  await ctx.dispose();
});

test('upload via X-API-Key authenticates correctly', async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  await bootstrap(ctx, 'apiowner');

  const { project } = (await (
    await ctx.post('/api/projects', { data: { name: 'API Key Demo' } })
  ).json()) as { project: { id: string } };

  const { key } = (await (
    await ctx.post('/api/api-keys', { data: { name: 'Plugin' } })
  ).json()) as { key: { plain: string } };

  // Use a fresh anonymous context to ensure it auths only via the header.
  const anon = await playwright.request.newContext();
  const upload = await anon.post(`/api/projects/${project.id}/files`, {
    headers: { 'x-api-key': key.plain },
    multipart: {
      path: 'via-key.txt',
      file: { name: 'via-key.txt', mimeType: 'text/plain', buffer: Buffer.from('from key auth') },
    },
  });
  expect(upload.status()).toBe(201);

  // Without the header → 401.
  const noAuth = await anon.post(`/api/projects/${project.id}/files`, {
    multipart: {
      path: 'should-fail.txt',
      file: { name: 'x', mimeType: 'text/plain', buffer: Buffer.from('x') },
    },
  });
  expect(noAuth.status()).toBe(401);

  await ctx.dispose();
  await anon.dispose();
});

test('rejects path traversal in upload', async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  await bootstrap(ctx, 'pathtest');
  const { project } = (await (
    await ctx.post('/api/projects', { data: { name: 'Traversal Demo' } })
  ).json()) as { project: { id: string } };

  const res = await ctx.post(`/api/projects/${project.id}/files`, {
    multipart: {
      path: '../../etc/passwd',
      file: { name: 'p', mimeType: 'text/plain', buffer: Buffer.from('x') },
    },
  });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe('invalid_path');

  await ctx.dispose();
});

test('viewer cannot edit files', async ({ playwright }) => {
  const ownerCtx = await playwright.request.newContext();
  const viewerCtx = await playwright.request.newContext();
  const ownerInfo = await bootstrap(ownerCtx, 'owner-perm');
  const viewerInfo = await bootstrap(viewerCtx, 'viewer-perm');

  const { project } = (await (
    await ownerCtx.post('/api/projects', { data: { name: 'Perm Demo' } })
  ).json()) as { project: { id: string } };

  await ownerCtx.post(`/api/projects/${project.id}/members`, {
    data: { email: viewerInfo.email, role: 'VIEWER' },
  });

  // Viewer can list but cannot upload.
  const listRes = await viewerCtx.get(`/api/projects/${project.id}/files`);
  expect(listRes.status()).toBe(200);

  const uploadRes = await viewerCtx.post(`/api/projects/${project.id}/files`, {
    multipart: {
      path: 'not-allowed.md',
      file: { name: 'x', mimeType: 'text/plain', buffer: Buffer.from('x') },
    },
  });
  expect(uploadRes.status()).toBe(403);

  await ownerCtx.dispose();
  await viewerCtx.dispose();
  void ownerInfo;
});
