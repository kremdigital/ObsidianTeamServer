import { defineConfig } from 'tsup';

/**
 * Build the standalone Socket.IO process to `dist/socket/server.js`.
 *
 * The web process is built by `next build`; this config only targets the
 * socket entrypoint and its module graph (lib/db, lib/auth, lib/sync,
 * lib/crdt, lib/files, lib/logger, …).
 */
export default defineConfig({
  entry: {
    'socket/server': 'src/socket/server.ts',
    'socket/main': 'src/socket/main.ts',
  },
  outDir: 'dist',
  // Emit as ESM with .mjs extension so Node treats it as ESM regardless of
  // the package.json `type` field (which we keep as the implicit "commonjs"
  // for ecosystem.config.cjs compatibility and Next interop).
  format: ['esm'],
  target: 'node20',
  splitting: false,
  sourcemap: true,
  clean: true,
  // Native or runtime-resolved deps stay external — they're installed via pnpm
  // on the deploy host and resolved from node_modules at runtime.
  external: ['@prisma/client', '.prisma/client', '@prisma/adapter-pg', 'pg', 'bcryptjs'],
  outExtension: () => ({ js: '.mjs' }),
  // ESM bundles can include code that does CommonJS-style `require()` for
  // node built-ins (e.g. some logger transports). Provide a top-level
  // `require` shim so those calls resolve at runtime.
  banner: {
    js: "import { createRequire as __osyncCreateRequire } from 'node:module'; const require = __osyncCreateRequire(import.meta.url);",
  },
  esbuildOptions(options) {
    options.platform = 'node';
    options.mainFields = ['module', 'main'];
  },
});
