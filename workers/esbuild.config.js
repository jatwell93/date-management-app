// esbuild configuration for Cloudflare Workers
// Externalizes native Node.js modules that can't run in Workers runtime

module.exports = {
  external: [
    // Native bindings and filesystem
    'sqlite3',
    'better-sqlite3',
    '@mapbox/node-pre-gyp',
    'node-pre-gyp',
    'mock-aws-s3',
    'aws-sdk',
    'nock',
    'fs',
    'path',
    'crypto',
    'util',
    'stream',
    'events',
    'assert',
    'process',
    'url',
    // Test-only dependencies
    'mock-fs',
    '@types/mock-fs',
  ],
  platform: 'browser',
  target: 'es2021',
  format: 'esm',
  bundle: true,
  minify: false, // For development debugging
  sourcemap: true,
  loader: {
    '.html': 'text', // Handle HTML files as text
  },
};
