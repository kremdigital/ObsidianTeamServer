import { expect, test } from '@playwright/test';
import { e2ePrisma, resetE2eDatabase } from './helpers/db';

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await resetE2eDatabase();
  await e2ePrisma.serverConfig.upsert({
    where: { key: 'openRegistration' },
    update: { value: true },
    create: { key: 'openRegistration', value: true },
  });

  // Bootstrap a verified user and log in via the API.
  const email = `keys-${Date.now()}@example.com`;
  const password = 'StrongPass1!';
  await page.request.post('/api/auth/register', {
    data: { email, password, name: 'Keys' },
  });
  const user = await e2ePrisma.user.findUnique({ where: { email: email.toLowerCase() } });
  await e2ePrisma.user.update({
    where: { id: user!.id },
    data: { emailVerified: new Date() },
  });
  await page.request.post('/api/auth/login', { data: { email, password } });
});

test.afterAll(async () => {
  await e2ePrisma.$disconnect();
});

test('create, copy and delete an API key via UI', async ({ page }) => {
  await page.goto('/api-keys');
  await expect(page.getByRole('heading', { name: 'API-ключи' })).toBeVisible();

  // Empty state initially.
  await expect(page.getByText('Ключей пока нет')).toBeVisible();

  // Open create dialog.
  await page.getByRole('button', { name: 'Создать ключ' }).click();
  await page.getByLabel('Название').fill('Test laptop');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();

  // The "key shown once" dialog must appear with the full plain key.
  await expect(page.getByText('Ключ создан')).toBeVisible();
  const code = page.locator('code').first();
  const plain = (await code.textContent()) ?? '';
  expect(plain).toMatch(/^osync_[0-9a-f]{64}$/);

  // Close the disclosure dialog.
  await page.getByRole('button', { name: 'Готово' }).click();

  // Table now shows the key by name and prefix.
  await expect(page.getByRole('cell', { name: 'Test laptop' })).toBeVisible();
  await expect(page.getByText('osync_', { exact: false })).toBeVisible();

  // Verify in DB that key was persisted hashed (not in plain).
  const dbKeys = await e2ePrisma.apiKey.findMany({ where: { name: 'Test laptop' } });
  expect(dbKeys).toHaveLength(1);
  expect(dbKeys[0]?.keyHash).not.toBe(plain);
  expect(dbKeys[0]?.keyPrefix).toBe(plain.slice(0, 12));

  // Delete via UI.
  await page.getByRole('button', { name: 'Удалить' }).first().click();
  await page.getByRole('button', { name: 'Удалить', exact: true }).last().click();

  await expect(page.getByText('Ключей пока нет')).toBeVisible();
  expect(await e2ePrisma.apiKey.count({ where: { name: 'Test laptop' } })).toBe(0);
});
