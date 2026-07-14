import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

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
