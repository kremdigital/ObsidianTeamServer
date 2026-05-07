import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/integration/**/*.{test,spec}.ts'],
    exclude: ['node_modules/**', '.next/**'],
    setupFiles: ['./tests/integration/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    env: {
      DATABASE_URL: 'postgresql://obsidian:obsidian@localhost:5432/obsidian_sync_test',
      TEST_DATABASE_URL: 'postgresql://obsidian:obsidian@localhost:5432/obsidian_sync_test',
      JWT_SECRET: 'test-jwt-secret-not-for-prod-do-not-use-in-real-environments',
      JWT_REFRESH_SECRET: 'test-jwt-refresh-secret-not-for-prod-do-not-use-in-real',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL: '30d',
      PUBLIC_URL: 'http://localhost:3000',
      LOG_DIR: './logs',
      LOG_LEVEL: 'warn',
      NODE_ENV: 'test',
    },
  },
});
