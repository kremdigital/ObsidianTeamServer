import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT_WEB ?? 3000);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: 'postgresql://obsidian:obsidian@localhost:5432/obsidian_sync_test',
      JWT_SECRET: 'e2e-jwt-secret-not-for-prod-do-not-use-in-real-environments',
      JWT_REFRESH_SECRET: 'e2e-jwt-refresh-secret-not-for-prod-do-not-use-in-real',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL: '30d',
      PUBLIC_URL: BASE_URL,
      LOG_DIR: './logs',
      STORAGE_PATH: './storage-e2e',
    },
  },
});
