import { expect, test } from '@playwright/test';
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

test('register → verify-email → login → logout → refresh denied', async ({ request }) => {
  const email = `flow-${Date.now()}@example.com`;
  const password = 'StrongPassword1!';

  // 1. Register
  const reg = await request.post('/api/auth/register', {
    data: { email, password, name: 'Flow' },
  });
  expect(reg.status()).toBe(201);

  // 2. Read verification token from DB
  const user = await e2ePrisma.user.findUnique({ where: { email: email.toLowerCase() } });
  expect(user).not.toBeNull();
  expect(user?.emailVerified).toBeNull();

  const token = await e2ePrisma.emailVerificationToken.findFirst({
    where: { userId: user!.id },
  });
  expect(token).not.toBeNull();

  // 3. Verify email
  const verify = await request.post('/api/auth/verify-email', {
    data: { token: token!.token },
  });
  expect(verify.status()).toBe(200);

  const verified = await e2ePrisma.user.findUnique({ where: { id: user!.id } });
  expect(verified?.emailVerified).not.toBeNull();

  // 4. Login
  const login = await request.post('/api/auth/login', { data: { email, password } });
  expect(login.status()).toBe(200);
  const loginBody = await login.json();
  expect(loginBody.accessToken).toBeTruthy();
  expect(loginBody.user.email).toBe(email.toLowerCase());

  const cookies = (await request.storageState()).cookies;
  const refreshCookie = cookies.find((c) => c.name === 'osync_refresh');
  expect(refreshCookie).toBeTruthy();

  // 5. Refresh while session is alive — should rotate refresh-cookie and return access token
  const oldRefresh = refreshCookie!.value;
  const refresh = await request.post('/api/auth/refresh');
  expect(refresh.status()).toBe(200);
  const refreshBody = await refresh.json();
  expect(refreshBody.accessToken).toBeTruthy();

  const cookiesAfterRefresh = (await request.storageState()).cookies;
  const newRefresh = cookiesAfterRefresh.find((c) => c.name === 'osync_refresh');
  expect(newRefresh?.value).toBeTruthy();
  expect(newRefresh?.value).not.toBe(oldRefresh);

  // 6. Logout
  const logout = await request.post('/api/auth/logout');
  expect(logout.status()).toBe(200);

  // 7. Refresh after logout — 401
  const refreshAfterLogout = await request.post('/api/auth/refresh');
  expect(refreshAfterLogout.status()).toBe(401);
});

test('register fails when registration is closed', async ({ request }) => {
  await e2ePrisma.serverConfig.update({
    where: { key: 'openRegistration' },
    data: { value: false },
  });

  const res = await request.post('/api/auth/register', {
    data: {
      email: `closed-${Date.now()}@example.com`,
      password: 'StrongPassword1!',
      name: 'Closed',
    },
  });
  expect(res.status()).toBe(403);
});

test('login rejects wrong password', async ({ request }) => {
  const email = `wrong-${Date.now()}@example.com`;

  await request.post('/api/auth/register', {
    data: { email, password: 'StrongPassword1!', name: 'X' },
  });

  const login = await request.post('/api/auth/login', {
    data: { email, password: 'WrongPassword!' },
  });
  expect(login.status()).toBe(401);
});
