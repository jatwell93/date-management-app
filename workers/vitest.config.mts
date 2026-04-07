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
        exclude: runPreviewTests ? [] : ['src/workers-deployment.test.ts'],
        globals: true,
    },
});
