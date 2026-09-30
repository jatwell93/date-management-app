import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const runPreviewTests = process.env.RUN_WORKERS_PREVIEW_TESTS === 'true';

const workersDir = path.dirname(fileURLToPath(import.meta.url));

// Hermetic tests, not ambient ones. Wrangler loads `.dev.vars` from the
// directory containing its config file — including when the vitest workerd
// pool reads it — and `npm run dev:local` setup has every developer create a
// real `workers/.dev.vars`. Without this indirection those secrets enter the
// test environment and break tests that assert missing-config behaviour
// (`health.test.ts` expects 500s when no database config is present). The pool
// therefore points at a generated copy of the real config in a throwaway
// directory: identical bindings, no neighbouring secret file. Only `main` is
// rebased to reach `dist/` from the subdirectory.
const vitestConfigDir = path.join(workersDir, '.vitest-tmp');
mkdirSync(vitestConfigDir, { recursive: true });
const MAIN_LINE = 'main = "dist/index.js"';
const sourceToml = readFileSync(path.join(workersDir, 'wrangler.toml'), 'utf8');
if (!sourceToml.includes(MAIN_LINE)) {
  throw new Error(`vitest.config.mts: expected \`${MAIN_LINE}\` in wrangler.toml`);
}
writeFileSync(
  path.join(vitestConfigDir, 'wrangler.toml'),
  sourceToml.replace(MAIN_LINE, 'main = "../dist/index.js"'),
);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './.vitest-tmp/wrangler.toml' },
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
