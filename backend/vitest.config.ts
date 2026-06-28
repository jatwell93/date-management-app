import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import path from 'node:path';

// Default (development) Vitest config — SQLite, mirrors the former jest.config.js.
// The Neon/PostgreSQL variant lives in vitest.config.neon.ts.
export default defineConfig({
  // Vitest 4 bundles a Vite whose default TS transformer is Oxc, which emits
  // `design:paramtypes` as `void 0` for class param types — breaking tsyringe.
  // Disabling it (note: `oxc: false`, not the now-inert `esbuild: false`) cedes
  // all TS transformation to SWC below, which emits correct decorator metadata.
  oxc: false,
  plugins: [
    // SWC replaces the default transform so decorator metadata (design:paramtypes)
    // is emitted — tsyringe needs it for @injectable classes whose constructor
    // params are not individually annotated with @inject.
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
    // Mirror the former jest moduleNameMapper `^@/(.*)` -> src/$1.
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    globalSetup: ['./test-setup.js'],
    setupFiles: ['./src/tests/setup-env.ts', './src/tests/setup-after-env.ts'],
    // The suite shares one SQLite database file and the global beforeEach in
    // setup-after-env truncates/seeds it, so files MUST run serially (the former
    // jest maxWorkers:1). `pool: forks` + fileParallelism:false keeps per-file
    // module isolation (matching jest's fresh registry) while running in sequence.
    pool: 'forks',
    fileParallelism: false,
    // Integration suites can exceed the 10s hook default on Windows/SQLite; the
    // former setup-after-env set jest.setTimeout(60_000) for the same reason.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'text-summary', 'json-summary', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/tests/**',
        'src/__mocks__/**',
        'src/migrations/**',
        'src/index.ts',
        'src/config/**',
        'src/utils/normalize.function.ts',
        'src/utils/retry.ts',
      ],
      thresholds: {
        statements: 75,
        branches: 70,
        functions: 75,
        lines: 75,
      },
    },
  },
});
