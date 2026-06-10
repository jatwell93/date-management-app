/**
 * Custom esbuild script for Workers build
 * Handles externalization of Node.js native modules that can't run in Workers
 */
const esbuild = require('esbuild');
const path = require('path');

async function build() {
  try {
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'src/index-minimal.ts')],
      bundle: true,
      outfile: path.join(__dirname, 'dist/index.js'),
      format: 'esm',
      target: 'es2022',
      platform: 'neutral',
      conditions: ['workerd', 'worker', 'browser'],
      mainFields: ['browser', 'module', 'main'],
      sourcemap: true,
      minify: true,
      drop: ['console'],
      legalComments: 'none',

      // Externalize Node.js native modules that can't run in Workers
      external: [
        // Native SQLite bindings
        'sqlite3',
        'better-sqlite3',
        '@mapbox/node-pre-gyp',
        'node-pre-gyp',

        // AWS SDK (not needed in Workers)
        'mock-aws-s3',
        'aws-sdk',
        'nock',

        // Node.js built-ins (both with and without node: prefix)
        'fs',
        'node:fs',
        'path',
        'node:path',
        'crypto',
        'node:crypto',
        'util',
        'node:util',
        'stream',
        'node:stream',
        'events',
        'node:events',
        'assert',
        'node:assert',
        'process',
        'node:process',
        'url',
        'node:url',
        'http',
        'node:http',
        'https',
        'node:https',
        'zlib',
        'node:zlib',
        'net',
        'node:net',
        'tls',
        'node:tls',
        'os',
        'node:os',
        'child_process',
        'node:child_process',
        'querystring',
        'node:querystring',
        'buffer',
        'node:buffer',
        'timers',
        'node:timers',
        'string_decoder',
        'node:string_decoder',
        'async_hooks',
        'node:async_hooks',

        // Test dependencies
        'mock-fs',
        '@types/mock-fs',
      ],

      // Handle .html files
      loader: {
        '.html': 'text',
      },

      // Define for environment detection
      define: {
        'process.env.WORKERS_ENVIRONMENT': '"true"',
        // Remove Sentry's debug-only branches from the production Worker bundle.
        __SENTRY_DEBUG__: 'false',
      },

      // Log level
      logLevel: 'info',
    });

    console.log('✅ Workers build completed successfully');
  } catch (error) {
    console.error('❌ Workers build failed:', error);
    process.exit(1);
  }
}

build();
