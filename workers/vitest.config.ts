import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

const runPreviewTests = process.env.RUN_WORKERS_PREVIEW_TESTS === 'true';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
    include: ['src/**/*.test.ts'],
    exclude: runPreviewTests ? [] : ['src/workers-deployment.test.ts'],
    globals: true,
  },
});
