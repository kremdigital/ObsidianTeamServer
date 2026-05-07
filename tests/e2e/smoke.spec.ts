import { expect, test } from '@playwright/test';

test('home page responds with 200', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBeTruthy();
});
