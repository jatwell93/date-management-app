import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import path from 'node:path';

// Neon/PostgreSQL (production-shape) Vitest config — mirrors the former
// jest.config.neon.js. Differs from the SQLite default in env setup file,
// global setup/teardown (which swaps the Prisma schema to Postgres and back),
// and the absence of coverage thresholds (this variant is correctness-only).
export default defineConfig({
  // See vitest.config.ts for why oxc must be disabled in favour of SWC.
  oxc: false,
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2021',
        parser: { syntax: 'typescript', decorators: true },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
        keepClassNames: true,
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // jest.config.neon.js used globalSetup + globalTeardown as two files; Vitest
    // takes a single global-setup module that exports `setup` and `teardown`.
    globalSetup: ['./vitest.global-setup.neon.js'],
    setupFiles: ['./src/tests/setup-neon-env.ts', './src/tests/setup-after-env.ts'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
