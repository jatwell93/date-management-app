import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const runPreviewTests = process.env.RUN_WORKERS_PREVIEW_TESTS === 'true';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      // No `miniflare.bindings` here on purpose. Supplying JWT_SECRET and
      // NEON_CONNECTION_STRING globally looks like the obvious fix for the
      // ambient env lacking secrets, and it breaks tests that depend on their
      // ABSENCE -- `health.test.ts` asserts a 500 for /api/dashboard when no
      // database config is present. Tests that care about configuration pass
      // their own env to `worker.fetch` instead.
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
    // `*.node.test.ts` run under the Node project (vitest.node.config.mts) because they
    // use pglite (WASM), which cannot load in the workerd pool.
    exclude: [
      'src/**/*.node.test.ts',
      ...(runPreviewTests ? [] : ['src/workers-deployment.test.ts']),
    ],
    globals: true,
  },
});
