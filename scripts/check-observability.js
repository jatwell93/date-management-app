#!/usr/bin/env node
/**
 * Phase 1 task 1.10 — observability readiness check.
 *
 * Task 1.10 requires that Cloudflare observability and Sentry are *verified*
 * enabled. Prose attestation is not verification: the same class of defect this
 * task exists to fix (`/health?deep=true` reporting `database: pass` without
 * executing a query) also applies to the observability story, which has three
 * independent silent-no-op paths:
 *
 *   1. `Sentry.withSentry({ dsn: env.WORKERS_SENTRY_DSN })` in
 *      `workers/src/index-minimal.ts:276` initialises with `dsn: undefined`
 *      when the secret is absent. It captures nothing, raises nothing, and the
 *      Worker looks instrumented while reporting to no one.
 *   2. The canary's Sentry step is skipped entirely when SENTRY_AUTH_TOKEN /
 *      SENTRY_ORG / SENTRY_PROJECT are unset.
 *   3. That step also fails open on any non-200, so a wrong project slug or a
 *      revoked token is indistinguishable from a clean canary.
 *
 * This script closes (1) and (3) for the *configuration*, by asserting two
 * properties that cannot be satisfied vacuously:
 *
 *   - the deployed Worker actually has WORKERS_SENTRY_DSN bound, and
 *   - the configured Sentry project has RECEIVED events within the quiet-period
 *     window.
 *
 * The ingest check is the load-bearing one. `index-minimal.ts:277` sets
 * `tracesSampleRate: 1.0`, so every request to a correctly-wired Worker produces
 * a transaction. A project with zero received events over a day is therefore
 * proof of a broken pipeline, not proof of a healthy service — which is exactly
 * how a DSN pointing at the wrong project presents.
 *
 * The two halves need different credentials, so they run as separate CI steps:
 * the secret list needs Cloudflare auth (via `doppler run`) and the `workers/`
 * working directory, while the ingest query needs only a Sentry token. Each half
 * requires only the configuration it actually uses, and refusing to skip both
 * keeps a "verified nothing" run impossible.
 *
 * Usage:
 *   # secret-binding half — from workers/, where wrangler.toml lives
 *   doppler run -- npx wrangler secret list --env production --format json \
 *     | node ../scripts/check-observability.js --no-ingest-check
 *
 *   # ingest half — from the repo root, needs only SENTRY_*
 *   node scripts/check-observability.js --no-secret-check
 *
 * Environment variables (required only when the ingest half runs):
 *   SENTRY_ORG                    — Sentry organization slug
 *   SENTRY_PROJECT                — Sentry project slug; must be the project the
 *                                   Worker's DSN points at, not the legacy
 *                                   Express project
 *   SENTRY_AUTH_TOKEN             — org auth token with event:read + project:read
 *   OBSERVABILITY_MAX_QUIET_HOURS — max acceptable window with zero received
 *                                   events (default 24)
 *
 * Exit codes:
 *   0 — the required Worker secret is bound AND the Sentry project has received
 *       events inside the window
 *   1 — a missing secret, a silent Sentry project, a missing configuration
 *       value, or any API error (fail closed)
 *
 * Output: a JSON evidence document on stdout suitable for CI artifact upload.
 */

const SENTRY_API_BASE = 'https://sentry.io/api/0';
const DEFAULT_MAX_QUIET_HOURS = 24;
const REQUIRED_WORKER_SECRETS = ['WORKERS_SENTRY_DSN'];

/**
 * Parse `wrangler secret list --format json` output into a list of secret names.
 *
 * Fails closed on anything unparseable: an unreadable secret list must not be
 * mistaken for a satisfied binding requirement.
 */
function parseSecretList(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(
      'No secret list on stdin. Pipe `wrangler secret list --env production --format json`, ' +
        'or pass --no-secret-check to skip this half explicitly.',
    );
  }

  // wrangler may prepend human-readable banner lines before the JSON payload.
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Secret list is not a JSON array; cannot verify secret bindings');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (error) {
    throw new Error(`Secret list is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Secret list is not a JSON array; cannot verify secret bindings');
  }

  return parsed
    .map((entry) => (entry && typeof entry === 'object' ? entry.name : entry))
    .filter((name) => typeof name === 'string' && name !== '');
}

/** Which of the required secrets are absent from the deployed Worker. */
function evaluateSecretBinding(names, required = REQUIRED_WORKER_SECRETS) {
  const present = new Set(names);
  const missing = required.filter((name) => !present.has(name));
  return { ok: missing.length === 0, missing, checked: required };
}

/**
 * Fetch the Sentry "received" event-count series for a project.
 *
 * `stat=received` counts everything the project ingested — errors AND
 * transactions — so it stays meaningful for a healthy service with no errors,
 * which an issues-based query would not.
 */
async function fetchReceivedStats(org, project, token, sinceHours, fetchImpl, now = Date.now()) {
  const since = Math.floor(now / 1000) - Math.round(sinceHours * 3600);
  const url =
    `${SENTRY_API_BASE}/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}` +
    `/stats/?stat=received&resolution=1h&since=${since}`;

  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    // Deliberately fail closed. The canary step tolerates a Sentry outage so a
    // deploy is never blocked by a third party; this check is a configuration
    // gate, where "cannot tell" must not read as "fine".
    throw new Error(
      `Sentry stats request failed with HTTP ${response.status}. ` +
        'Check SENTRY_AUTH_TOKEN scopes (event:read, project:read) and that ' +
        'SENTRY_PROJECT names the project the Worker DSN points at.',
    );
  }

  return response.json();
}

/**
 * A Sentry stats series is [[unixSeconds, count], ...]. Zero total received
 * events across the window means the ingest pipeline is broken, not that the
 * service is quiet — see the tracesSampleRate note in the file header.
 */
function evaluateIngest(series, sinceHours) {
  if (!Array.isArray(series)) {
    throw new Error('Sentry stats response was not an array; cannot evaluate ingest');
  }

  let total = 0;
  let lastEventAt = null;
  for (const point of series) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const [timestamp, count] = point;
    if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) continue;
    total += count;
    if (typeof timestamp === 'number' && (lastEventAt === null || timestamp > lastEventAt)) {
      lastEventAt = timestamp;
    }
  }

  return {
    ok: total > 0,
    receivedEvents: total,
    windowHours: sinceHours,
    lastEventAt: lastEventAt === null ? null : new Date(lastEventAt * 1000).toISOString(),
  };
}

function readRequired(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function parsePositiveNumber(value, fallback, name) {
  if (value === undefined || value === null || `${value}`.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number (got "${value}")`);
  }
  return parsed;
}

const VALID_FLAGS = new Set(['--no-secret-check', '--no-ingest-check']);

async function main(env, deps) {
  const { fetchImpl, readStdin, argv = [] } = deps;

  const unknown = argv.filter((arg) => !VALID_FLAGS.has(arg));
  if (unknown.length > 0) {
    throw new Error(`Unknown argument(s): ${unknown.join(', ')}`);
  }

  const skipSecretCheck = argv.includes('--no-secret-check');
  const skipIngestCheck = argv.includes('--no-ingest-check');

  // Skipping both would exit 0 having verified nothing — the exact shape of
  // defect this script exists to prevent.
  if (skipSecretCheck && skipIngestCheck) {
    throw new Error('Refusing to run with both checks skipped: that would verify nothing');
  }

  const evidence = {
    checkedAt: new Date().toISOString(),
    secretBinding: skipSecretCheck ? { ok: null, skipped: true } : undefined,
    ingest: skipIngestCheck ? { ok: null, skipped: true } : undefined,
  };
  const failures = [];

  // The two halves run in different CI jobs, because their credentials live in
  // different places: the secret list needs Cloudflare auth and the workers/
  // working directory, while the ingest query needs only a Sentry token. So each
  // half validates only the configuration it actually uses.
  if (!skipSecretCheck) {
    const names = parseSecretList(await readStdin());
    evidence.secretBinding = { ...evaluateSecretBinding(names), skipped: false };
    if (!evidence.secretBinding.ok) {
      failures.push(
        `Worker is missing required secret(s): ${evidence.secretBinding.missing.join(', ')}`,
      );
    }
  }

  if (!skipIngestCheck) {
    const org = readRequired(env, 'SENTRY_ORG');
    const project = readRequired(env, 'SENTRY_PROJECT');
    const token = readRequired(env, 'SENTRY_AUTH_TOKEN');
    const quietHours = parsePositiveNumber(
      env.OBSERVABILITY_MAX_QUIET_HOURS,
      DEFAULT_MAX_QUIET_HOURS,
      'OBSERVABILITY_MAX_QUIET_HOURS',
    );

    evidence.sentry = { org, project };
    const series = await fetchReceivedStats(org, project, token, quietHours, fetchImpl);
    evidence.ingest = { ...evaluateIngest(series, quietHours), skipped: false };

    if (!evidence.ingest.ok) {
      failures.push(
        `Sentry project ${org}/${project} received 0 events in the last ${quietHours}h. ` +
          'With tracesSampleRate 1.0 every request produces a transaction, so this means ' +
          'the Worker is not reporting to this project (wrong or unset DSN), not that it is idle.',
      );
    }
  }

  evidence.ok = failures.length === 0;
  evidence.failures = failures;
  return evidence;
}

module.exports = {
  parseSecretList,
  evaluateSecretBinding,
  fetchReceivedStats,
  evaluateIngest,
  main,
  DEFAULT_MAX_QUIET_HOURS,
  REQUIRED_WORKER_SECRETS,
};

if (require.main === module) {
  const readStdin = () =>
    new Promise((resolve, reject) => {
      let buffer = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        buffer += chunk;
      });
      process.stdin.on('end', () => resolve(buffer));
      process.stdin.on('error', reject);
    });

  main(process.env, { fetchImpl: fetch, readStdin, argv: process.argv.slice(2) })
    .then((evidence) => {
      process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
      process.exitCode = evidence.ok ? 0 : 1;
    })
    .catch((error) => {
      process.stderr.write(`Observability check failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}
