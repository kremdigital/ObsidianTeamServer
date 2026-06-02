import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Allow leading-underscore arguments to be intentionally unused (callback signatures).
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  // The note browser renders user vault images served by the authenticated
  // file-content API. Their dimensions are unknown and they aren't static
  // assets, so next/image doesn't apply — plain <img> is correct here.
  {
    files: ['src/components/notes/**/*.tsx'],
    rules: {
      '@next/next/no-img-element': 'off',
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Bundled output of `pnpm build:socket` (tsup).
    'dist/**',
  ]),
]);

export default eslintConfig;
