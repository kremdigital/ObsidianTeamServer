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

test('home redirects unauthenticated user to /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();
});

test('register form creates user on valid input', async ({ page }) => {
  await page.goto('/register');

  const email = `ui-${Date.now()}@example.com`;
  await page.getByLabel('Имя').fill('UI Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill('StrongPass1!');
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();

  await expect(page.getByText('Проверьте почту')).toBeVisible();

  const user = await e2ePrisma.user.findUnique({ where: { email: email.toLowerCase() } });
  expect(user).not.toBeNull();
});

test('login form rejects wrong password and accepts valid one', async ({ page }) => {
  // Bootstrap a verified user via API so we can log in.
  const email = `loginui-${Date.now()}@example.com`;
  const password = 'StrongPass1!';
  await page.request.post('/api/auth/register', {
    data: { email, password, name: 'Login UI' },
  });
  const user = await e2ePrisma.user.findUnique({ where: { email: email.toLowerCase() } });
  await e2ePrisma.user.update({
    where: { id: user!.id },
    data: { emailVerified: new Date() },
  });

  await page.goto('/login');

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill('WrongPass!');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByText('Неверный email или пароль')).toBeVisible();

  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Мои проекты' })).toBeVisible();
});
