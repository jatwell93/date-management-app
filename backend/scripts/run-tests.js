/**
 * Backend test launcher.
 *
 * Assigns each invocation its own SQLite database file in the OS temp dir BEFORE
 * Vitest starts, so the migration step (globalSetup) and every worker fork inherit
 * the same unique path. This prevents concurrent local test runs from sharing
 * `./test.db` and clobbering each other mid-test (e.g. csv-parser integration
 * failures with `imported: 0, updated: 10`).
 *
 * Vitest does not propagate process.env mutations from globalSetup into worker
 * forks, which is why the path must be decided here, ahead of spawning Vitest.
 *
 * All CLI args are forwarded verbatim, so the npm scripts decide `run` vs watch.
 */

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Respect an explicit override (e.g. CI or intentional parallel runs); otherwise
// allocate a unique absolute path. Absolute sidesteps Prisma's schema-relative
// SQLite path resolution.
let dbPath = process.env.TEST_DATABASE_PATH;
let ownsDbFile = false;

if (!dbPath) {
  const unique = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  dbPath = path.join(os.tmpdir(), `dm-backend-test-${unique}.db`);
  ownsDbFile = true;

  process.env.TEST_DATABASE_PATH = dbPath;
  process.env.DATABASE_PATH = dbPath;
  process.env.DATABASE_URL = `file:${dbPath}`;
}

function cleanup() {
  if (!ownsDbFile) return;
  for (const suffix of ['', '-shm', '-wal', '-journal']) {
    try {
      fs.unlinkSync(`${dbPath}${suffix}`);
    } catch {
      // ignore ENOENT and any other cleanup error
    }
  }
}

const vitestBin = path.resolve(
  __dirname,
  '..',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vitest.cmd' : 'vitest',
);

const child = spawn(vitestBin, process.argv.slice(2), {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

function forwardSignal(signal) {
  if (!child.killed) {
    child.kill(signal);
  }
}

process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));

child.on('exit', (code, signal) => {
  cleanup();
  if (signal) {
    // Re-raise so the parent shell observes the same termination signal. We must
    // first drop our own listener, otherwise the re-raised signal is caught by it
    // again (instead of taking the default "terminate" action) and the process
    // hangs in a loop. Removing the listener restores the default disposition.
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  cleanup();
  console.error(`Failed to launch Vitest: ${error.message}`);
  process.exit(1);
});
