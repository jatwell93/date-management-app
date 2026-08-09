#!/usr/bin/env node
/**
 * Unit tests for scripts/check-observability.js (task 1.10).
 *
 * Mocked fetch and stdin throughout — no network, no wrangler, no secrets.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseSecretList,
  evaluateSecretBinding,
  fetchReceivedStats,
  evaluateIngest,
  main,
} = require('./check-observability');

const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });
const errResponse = (status) => ({ ok: false, status, json: async () => ({}) });

const baseEnv = {
  SENTRY_ORG: 'acme',
  SENTRY_PROJECT: 'node-cloudflare-workers',
  SENTRY_AUTH_TOKEN: 'sntrys_token',
};

const hoursAgo = (h) => Math.floor(Date.now() / 1000) - h * 3600;

// ── parseSecretList ────────────────────────────────────────────────────────

test('parseSecretList reads names from wrangler JSON output', () => {
  const raw = JSON.stringify([
    { name: 'NEON_CONNECTION_STRING', type: 'secret_text' },
    { name: 'WORKERS_SENTRY_DSN', type: 'secret_text' },
  ]);
  assert.deepEqual(parseSecretList(raw), ['NEON_CONNECTION_STRING', 'WORKERS_SENTRY_DSN']);
});

test('parseSecretList tolerates a banner before the JSON array', () => {
  const raw = `Using vars defined in .env\n[{"name":"WORKERS_SENTRY_DSN"}]\n`;
  assert.deepEqual(parseSecretList(raw), ['WORKERS_SENTRY_DSN']);
});

test('parseSecretList survives a bracketed banner token before the payload', () => {
  // Real failure: `indexOf('[')` matched the dotenv banner, so JSON.parse ran on
  // "[dotenv@17.2.3] injecting env ... [ {...} ]" and threw at position 16.
  const raw =
    '[dotenv@17.2.3] injecting env (0) from .env\n' +
    '[{"name":"NEON_CONNECTION_STRING"},{"name":"WORKERS_SENTRY_DSN"}]\n';
  assert.deepEqual(parseSecretList(raw), ['NEON_CONNECTION_STRING', 'WORKERS_SENTRY_DSN']);
});

test('parseSecretList survives multiple bracketed banner tokens', () => {
  const raw =
    '[dotenv@17.2.3] injecting env\n' +
    '[custom build] running npm run build\n' +
    '[{"name":"WORKERS_SENTRY_DSN"}]\n' +
    'Done [ok]\n';
  assert.deepEqual(parseSecretList(raw), ['WORKERS_SENTRY_DSN']);
});

test('parseSecretList is not fooled by a bracket inside a secret name', () => {
  const raw = 'banner\n[{"name":"WEIRD]NAME"},{"name":"WORKERS_SENTRY_DSN"}]\n';
  assert.deepEqual(parseSecretList(raw), ['WEIRD]NAME', 'WORKERS_SENTRY_DSN']);
});

test('parseSecretList accepts a Worker with no secrets at all', () => {
  assert.deepEqual(parseSecretList('[]'), []);
});

test('parseSecretList fails closed on empty stdin', () => {
  assert.throws(() => parseSecretList(''), /No secret list on stdin/);
  assert.throws(() => parseSecretList('   '), /No secret list on stdin/);
});

test('parseSecretList fails closed on non-array or invalid JSON', () => {
  assert.throws(() => parseSecretList('not json at all'), /not valid JSON/);
  assert.throws(() => parseSecretList('[{"name": broken]'), /not valid JSON/);
  // An object payload is well-formed JSON but not a secret list.
  assert.throws(() => parseSecretList('{"secrets": 3}'), /not valid JSON|not a JSON array/);
});

// ── evaluateSecretBinding ──────────────────────────────────────────────────

test('evaluateSecretBinding passes when the DSN is bound', () => {
  const result = evaluateSecretBinding(['NEON_CONNECTION_STRING', 'WORKERS_SENTRY_DSN']);
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

test('evaluateSecretBinding reports a missing DSN — the silent no-op case', () => {
  const result = evaluateSecretBinding(['NEON_CONNECTION_STRING']);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['WORKERS_SENTRY_DSN']);
});

// ── evaluateIngest ─────────────────────────────────────────────────────────

test('evaluateIngest passes when the project received events', () => {
  const result = evaluateIngest(
    [
      [hoursAgo(3), 0],
      [hoursAgo(2), 41],
      [hoursAgo(1), 7],
    ],
    24,
  );
  assert.equal(result.ok, true);
  assert.equal(result.receivedEvents, 48);
  assert.ok(result.lastEventAt);
});

test('evaluateIngest FAILS on an all-zero series — a silent project is broken, not idle', () => {
  const result = evaluateIngest(
    [
      [hoursAgo(2), 0],
      [hoursAgo(1), 0],
    ],
    24,
  );
  assert.equal(result.ok, false);
  assert.equal(result.receivedEvents, 0);
  assert.equal(result.lastEventAt, null);
});

test('evaluateIngest fails on an empty series rather than passing vacuously', () => {
  assert.equal(evaluateIngest([], 24).ok, false);
});

test('evaluateIngest ignores malformed points instead of counting them', () => {
  const result = evaluateIngest([['bad'], [hoursAgo(1), 'x'], [hoursAgo(1), 5]], 24);
  assert.equal(result.receivedEvents, 5);
});

test('evaluateIngest rejects a non-array response', () => {
  assert.throws(() => evaluateIngest({ detail: 'nope' }, 24), /not an array/);
});

// ── fetchReceivedStats ─────────────────────────────────────────────────────

test('fetchReceivedStats requests stat=received for the configured project', async () => {
  let seenUrl;
  let seenAuth;
  const fetchImpl = async (url, init) => {
    seenUrl = url;
    seenAuth = init.headers.Authorization;
    return okResponse([[hoursAgo(1), 3]]);
  };
  await fetchReceivedStats('acme', 'node-cloudflare-workers', 'tok', 24, fetchImpl);
  assert.match(seenUrl, /\/projects\/acme\/node-cloudflare-workers\/stats\//);
  assert.match(seenUrl, /stat=received/);
  assert.equal(seenAuth, 'Bearer tok');
});

test('fetchReceivedStats fails closed on non-200 — a bad token is not a pass', async () => {
  const fetchImpl = async () => errResponse(403);
  await assert.rejects(() => fetchReceivedStats('acme', 'proj', 'tok', 24, fetchImpl), /HTTP 403/);
});

test('fetchReceivedStats URL-encodes org and project slugs', async () => {
  let seenUrl;
  const fetchImpl = async (url) => {
    seenUrl = url;
    return okResponse([]);
  };
  await fetchReceivedStats('a c', 'p/j', 'tok', 24, fetchImpl);
  assert.match(seenUrl, /projects\/a%20c\/p%2Fj\//);
});

// ── main ───────────────────────────────────────────────────────────────────

const deps = (overrides = {}) => ({
  fetchImpl: async () => okResponse([[hoursAgo(1), 12]]),
  readStdin: async () => JSON.stringify([{ name: 'WORKERS_SENTRY_DSN' }]),
  argv: [],
  ...overrides,
});

test('main passes when the DSN is bound and the project is ingesting', async () => {
  const evidence = await main(baseEnv, deps());
  assert.equal(evidence.ok, true);
  assert.deepEqual(evidence.failures, []);
  assert.equal(evidence.secretBinding.ok, true);
  assert.equal(evidence.ingest.ok, true);
});

test('main fails when the Worker has no Sentry DSN bound', async () => {
  const evidence = await main(
    baseEnv,
    deps({ readStdin: async () => JSON.stringify([{ name: 'NEON_CONNECTION_STRING' }]) }),
  );
  assert.equal(evidence.ok, false);
  assert.match(evidence.failures.join('\n'), /missing required secret\(s\): WORKERS_SENTRY_DSN/);
});

test('main fails on a silent Sentry project and explains why it is not idleness', async () => {
  const evidence = await main(baseEnv, deps({ fetchImpl: async () => okResponse([]) }));
  assert.equal(evidence.ok, false);
  assert.match(evidence.failures.join('\n'), /received 0 events/);
  assert.match(evidence.failures.join('\n'), /tracesSampleRate 1\.0/);
});

test('main reports both failures at once rather than stopping at the first', async () => {
  const evidence = await main(
    baseEnv,
    deps({
      readStdin: async () => JSON.stringify([{ name: 'JWT_SECRET' }]),
      fetchImpl: async () => okResponse([]),
    }),
  );
  assert.equal(evidence.failures.length, 2);
});

test('main requires each Sentry configuration value', async () => {
  for (const key of ['SENTRY_ORG', 'SENTRY_PROJECT', 'SENTRY_AUTH_TOKEN']) {
    const env = { ...baseEnv, [key]: '' };
    await assert.rejects(() => main(env, deps()), new RegExp(`${key} is required`));
  }
});

test('--no-secret-check skips only the secret half, and records the skip', async () => {
  const evidence = await main(
    baseEnv,
    deps({
      argv: ['--no-secret-check'],
      readStdin: async () => {
        throw new Error('stdin must not be read when the secret check is skipped');
      },
    }),
  );
  assert.equal(evidence.ok, true);
  assert.equal(evidence.secretBinding.skipped, true);
  assert.equal(evidence.ingest.ok, true);
});

test('main rejects unknown arguments so a typo cannot silently skip a check', async () => {
  await assert.rejects(
    () => main(baseEnv, deps({ argv: ['--no-secret-checks'] })),
    /Unknown argument\(s\): --no-secret-checks/,
  );
});

test('--no-ingest-check verifies only the secret binding', async () => {
  const evidence = await main(
    {},
    deps({
      argv: ['--no-ingest-check'],
      fetchImpl: async () => {
        throw new Error('Sentry must not be queried when the ingest check is skipped');
      },
    }),
  );
  assert.equal(evidence.ok, true);
  assert.equal(evidence.secretBinding.ok, true);
  assert.equal(evidence.ingest.skipped, true);
});

test('--no-ingest-check does not require SENTRY_* — its credentials live elsewhere', async () => {
  const evidence = await main({}, deps({ argv: ['--no-ingest-check'] }));
  assert.equal(evidence.ok, true);
});

test('--no-ingest-check still fails on a missing DSN', async () => {
  const evidence = await main(
    {},
    deps({
      argv: ['--no-ingest-check'],
      readStdin: async () => JSON.stringify([{ name: 'JWT_SECRET' }]),
    }),
  );
  assert.equal(evidence.ok, false);
  assert.match(evidence.failures.join('\n'), /WORKERS_SENTRY_DSN/);
});

test('--no-secret-check does not require a secret list on stdin', async () => {
  const evidence = await main(baseEnv, deps({ argv: ['--no-secret-check'] }));
  assert.equal(evidence.ok, true);
  assert.equal(evidence.secretBinding.skipped, true);
  assert.equal(evidence.ingest.ok, true);
});

test('refuses to run with BOTH checks skipped — that would verify nothing', async () => {
  await assert.rejects(
    () => main(baseEnv, deps({ argv: ['--no-secret-check', '--no-ingest-check'] })),
    /would verify nothing/,
  );
});

test('main rejects a non-positive quiet-hours override', async () => {
  await assert.rejects(
    () => main({ ...baseEnv, OBSERVABILITY_MAX_QUIET_HOURS: '0' }, deps()),
    /must be a positive number/,
  );
});
