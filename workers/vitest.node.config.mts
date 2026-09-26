import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Pin the test process to UTC before workers fork: the real schema uses
// TIMESTAMP(3) without time zone, so values would otherwise shift by the
// machine's UTC offset (dev machines are in Australia; CI is UTC).
process.env.TZ = 'UTC';

/**
 * Node-environment test project for DB integration tests that run real SQL against
 * pglite (WASM, needs Node — cannot run under the workerd vitest pool). Matches only
 * `*.node.test.ts`; the default `vitest.config.mts` (workerd pool) excludes these.
 *
 * `@sentry/cloudflare` is aliased to a stub so index-minimal.ts imports under Node.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@sentry/cloudflare': fileURLToPath(
        new URL('./src/__tests__/sentry-cloudflare-stub.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.node.test.ts'],
    globals: true,
    // Each file boots a PGlite WASM database. Running several bootstraps at once
    // exhausts memory on CI and turns healthy setup into nondeterministic timeouts.
    fileParallelism: false,
    hookTimeout: 60000,
  },
});
