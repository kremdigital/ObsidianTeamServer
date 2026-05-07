import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**'],
    env: {
      // Some modules eagerly construct the Prisma client at import time.
      // Provide a placeholder URL so unit tests that don't actually hit the DB still load.
      DATABASE_URL: 'postgresql://obsidian:obsidian@localhost:5432/obsidian_sync_test',
      JWT_SECRET: 'unit-jwt-secret-not-for-prod',
      JWT_REFRESH_SECRET: 'unit-jwt-refresh-secret-not-for-prod',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/*.d.ts', 'src/messages/**'],
    },
  },
});
