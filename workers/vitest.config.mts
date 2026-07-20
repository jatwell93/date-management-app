import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const runPreviewTests = process.env.RUN_WORKERS_PREVIEW_TESTS === 'true';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
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
