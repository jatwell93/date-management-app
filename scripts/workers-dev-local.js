#!/usr/bin/env node
'use strict';

/**
 * Launch `wrangler dev` for the Workers app against a developer-owned Neon
 * branch (task 3.6 of retire-express-unify-on-postgres).
 *
 * Reads `workers/.dev.vars` (dotenv syntax: KEY=VALUE, optional single/double
 * quotes, `#` comments, blank lines), requires NEON_CONNECTION_STRING, and
 * exports it to the child as
 * CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE — the documented
 * env var wrangler dev honours for a local Hyperdrive connection. The
 * `[env.development]` Hyperdrive binding in wrangler.toml reuses the
 * production Hyperdrive id; supplying the local connection string makes
 * wrangler connect directly and never touch that id.
 *
 * Usage:
 *   cd workers && npm run dev:local            # or: node ../scripts/workers-dev-local.js
 *   extra args are forwarded to wrangler dev, e.g. `-- --log-level debug`
 *
 * The connection string is never printed — only a redacted host:port form.
 */

const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEV_VARS_FILENAME = '.dev' + '.vars';
const REQUIRED_KEY = 'NEON_CONNECTION_STRING';
const HYPERDRIVE_LOCAL_ENV = 'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE';
const PLACEHOLDER_MARKER = '<';

/**
 * Parse a dotenv value (the already-trimmed text after `=`).
 * A value quoted on both ends — optionally followed by an inline `#` comment —
 * returns its quoted contents verbatim; the lazy group keeps `#` inside the
 * quotes ("a # b") and stops before a quoted comment ("a" # "b"). Unquoted
 * values strip an inline comment only when it follows whitespace — a `#`
 * directly after the value (no space) is part of the value.
 */
function parseDevVarValue(raw) {
  const quoted = raw.match(/^(["'])(.*?)\1(?:\s+#.*)?$/);
  if (quoted) return quoted[2];
  const hashIdx = raw.search(/\s#/);
  return hashIdx === -1 ? raw : raw.slice(0, hashIdx).trimEnd();
}

/**
 * Parse dotenv-style content into a {key: value} map.
 * Supports `KEY=VALUE`, optional surrounding single/double quotes, `export`
 * prefixes, inline `#` comments outside quotes, and blank lines.
 */
function parseDevVars(content) {
  const vars = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const stripped = line.startsWith('export ') ? line.slice(7).trimStart() : line;
    const eq = stripped.indexOf('=');
    if (eq <= 0) continue;
    const key = stripped.slice(0, eq).trim();
    vars[key] = parseDevVarValue(stripped.slice(eq + 1).trim());
  }
  return vars;
}

/**
 * Validate the parsed vars. Returns an error string, or null when usable.
 */
function validateDevVars(vars, devVarsPath) {
  const value = vars[REQUIRED_KEY];
  if (value === undefined || value === '') {
    return (
      `${REQUIRED_KEY} is missing from ${devVarsPath}. ` +
      `Copy workers/${DEV_VARS_FILENAME}.example to workers/${DEV_VARS_FILENAME} ` +
      `and fill in the pooled URI of your own Neon branch (never production).`
    );
  }
  if (value.includes(PLACEHOLDER_MARKER)) {
    return (
      `${REQUIRED_KEY} in ${devVarsPath} still contains a placeholder ` +
      `(${PLACEHOLDER_MARKER}...). Replace it with your real Neon branch URI — ` +
      `see workers/${DEV_VARS_FILENAME}.example.`
    );
  }
  return null;
}

/** Redact a postgres URI to `postgres://host:port/database`. */
function redactConnectionString(value) {
  try {
    const url = new URL(value);
    return `postgres://${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname}`;
  } catch {
    return 'postgres://<unparseable URI — redacted>';
  }
}

/**
 * Build the child-process environment: the base env plus the Hyperdrive local
 * connection-string variable. `.dev.vars` values are NOT overlaid — wrangler
 * reads that file itself for bindings, and copying every key into the child
 * env would leak secrets into npx/wrangler and let a `CLOUDFLARE_*` /
 * `WRANGLER_*` key silently change wrangler's own behaviour.
 */
function buildChildEnv(vars, baseEnv = process.env) {
  const env = { ...baseEnv };
  if (!env[HYPERDRIVE_LOCAL_ENV]) {
    env[HYPERDRIVE_LOCAL_ENV] = vars[REQUIRED_KEY];
  }
  return env;
}

/**
 * Warning text when the environment already pins a Hyperdrive local
 * connection string that differs from .dev.vars NEON_CONNECTION_STRING: the
 * preset wins for the Hyperdrive binding while the Worker itself uses
 * NEON_CONNECTION_STRING, which is a real divergence worth surfacing.
 * Returns null when there is nothing to warn about.
 */
function hyperdrivePresetWarning(vars, baseEnv = process.env) {
  const preset = baseEnv[HYPERDRIVE_LOCAL_ENV];
  const neon = vars[REQUIRED_KEY];
  if (!preset || !neon || preset === neon) return null;
  return (
    `${HYPERDRIVE_LOCAL_ENV} is already set in the environment and wins for ` +
    `the Hyperdrive binding: ${redactConnectionString(preset)} — while the ` +
    `Worker's own queries use NEON_CONNECTION_STRING: ` +
    `${redactConnectionString(neon)}. Unset the former if unintended.`
  );
}

function main() {
  const workersDir = path.resolve(__dirname, '..', 'workers');
  const devVarsPath = path.join(workersDir, DEV_VARS_FILENAME);

  if (!existsSync(devVarsPath)) {
    console.error(
      `[dev:local] ${devVarsPath} not found. ` +
        `Copy workers/${DEV_VARS_FILENAME}.example to workers/${DEV_VARS_FILENAME} ` +
        `and fill in your own Neon branch URI first.`,
    );
    process.exit(1);
  }

  const vars = parseDevVars(readFileSync(devVarsPath, 'utf8'));
  const error = validateDevVars(vars, devVarsPath);
  if (error) {
    console.error(`[dev:local] ${error}`);
    process.exit(1);
  }

  const env = buildChildEnv(vars);
  const warning = hyperdrivePresetWarning(vars);
  if (warning) console.warn(`[dev:local] ${warning}`);
  console.log(`[dev:local] Neon branch: ${redactConnectionString(vars[REQUIRED_KEY])}`);
  console.log('[dev:local] starting wrangler dev --env development --port 8787');

  const isWin = process.platform === 'win32';
  const child = spawn(
    'npx',
    ['wrangler', 'dev', '--env', 'development', '--port', '8787', ...process.argv.slice(2)],
    { cwd: workersDir, env, stdio: 'inherit', shell: isWin },
  );
  child.on('error', (err) => {
    console.error(`[dev:local] failed to start wrangler: ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => forwardChildExit(code, signal));
}

/**
 * Propagate a child exit to this process: forward the signal to ourselves so
 * the parent sees the same termination, else exit with the child's code.
 * Windows Node only supports SIGINT/SIGTERM/SIGKILL on kill(), so an
 * unsupported signal falls back to exit(1) instead of throwing.
 */
function forwardChildExit(code, signal, proc = process) {
  if (signal) {
    try {
      proc.kill(proc.pid, signal);
    } catch {
      proc.exit(1);
    }
    return;
  }
  proc.exit(code ?? 1);
}

module.exports = {
  parseDevVars,
  parseDevVarValue,
  forwardChildExit,
  validateDevVars,
  redactConnectionString,
  buildChildEnv,
  hyperdrivePresetWarning,
  REQUIRED_KEY,
  HYPERDRIVE_LOCAL_ENV,
  PLACEHOLDER_MARKER,
  DEV_VARS_FILENAME,
};

if (require.main === module) {
  main();
}
