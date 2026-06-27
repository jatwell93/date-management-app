import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

const sharedMarkdownPath = path.resolve(__dirname, '../shared/domain/markdown.ts');

// Every REACT_APP_* var referenced in source must appear in `define`, otherwise
// the literal `process.env.X` survives into the browser bundle and throws a
// ReferenceError (there is no `process` global in the browser). We seed the
// known keys to '' so an unset secret resolves to an empty string rather than
// crashing, then overlay whatever loadEnv finds (.env files AND matching
// process.env keys, e.g. the REACT_APP_* vars the deploy workflow exports).
const REACT_APP_KEYS = [
  'REACT_APP_CLERK_PUBLISHABLE_KEY',
  'REACT_APP_API_URL',
  'REACT_APP_API_BASE_URL',
  'REACT_APP_WORKERS_URL',
  'REACT_APP_SENTRY_FRONTEND_DSN',
  'REACT_APP_VERSION',
  'REACT_APP_EXPECT_QA_STATUS',
  'REACT_APP_STRIPE_PRICE_STARTER_MONTHLY',
  'REACT_APP_STRIPE_PRICE_STARTER_ANNUAL',
  'REACT_APP_STRIPE_PRICE_PROFESSIONAL_MONTHLY',
  'REACT_APP_STRIPE_PRICE_PROFESSIONAL_ANNUAL',
];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'REACT_APP_');

  const defineEnv: Record<string, string> = {
    // CRA exposed the homepage as PUBLIC_URL; we serve from root, so '' is correct.
    'process.env.PUBLIC_URL': JSON.stringify(''),
  };
  for (const key of REACT_APP_KEYS) {
    defineEnv[`process.env.${key}`] = JSON.stringify(env[key] ?? '');
  }

  return {
    plugins: [
      react(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'service-worker.ts',
        // We register the SW ourselves in serviceWorkerRegistration.ts, and the
        // web app manifest is the existing public/manifest.json.
        injectRegister: false,
        manifest: false,
        injectManifest: {
          // App is mostly JS/CSS/fonts; raise the precache size ceiling above the
          // 2 MiB default so the main bundle is precached.
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    resolve: {
      alias: {
        '@shared/markdown': sharedMarkdownPath,
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 3002,
      fs: {
        // Allow importing ../shared/domain/markdown.ts from outside the project root.
        allow: ['..'],
      },
    },
    build: {
      // Cloudflare Pages deploy + CI expect the CRA output directory name.
      outDir: 'build',
      sourcemap: true,
    },
    define: defineEnv,
    // Also expose REACT_APP_* on import.meta.env for the eventual migration off
    // process.env; harmless today.
    envPrefix: 'REACT_APP_',
  };
});
