const test = require('node:test');
const assert = require('node:assert/strict');

const {
  probeEndpoint,
  evaluateProbe,
  main,
  DEFAULT_ENDPOINTS,
  ENDPOINT_EXPECTATIONS,
} = require('./post-deploy-smoke.js');

function makeResponse(status, body, contentType = 'application/json') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function makeFetch(responses) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const entry = responses[url];
    if (!entry) throw new Error(`unexpected fetch ${url}`);
    if (entry instanceof Error) throw entry;
    return makeResponse(entry.status, entry.body, entry.contentType);
  };
  fn.calls = calls;
  return fn;
}

/**
 * Shared harness for `main` tests: builds the fetch impl, wires stdout/stderr
 * capture, invokes main, and parses the JSON evidence document. Returns the
 * pieces each test still needs to assert on.
 *
 * @param {Record<string, { status: number; body: unknown; contentType?: string } | Error>} responses
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<{ code: number; out: string; err: string; fetchImpl: ReturnType<typeof makeFetch>; evidence: unknown }>}
 */
async function runMain(responses, env) {
  const outChunks = [];
  const errChunks = [];
  const fetchImpl = makeFetch(responses);
  const code = await main(env, {
    fetch: fetchImpl,
    stdout: { write: (s) => outChunks.push(s) },
    stderr: { write: (s) => errChunks.push(s) },
  });
  const out = outChunks.join('');
  const err = errChunks.join('');
  let evidence;
  if (out) {
    try {
      evidence = JSON.parse(out);
    } catch {
      evidence = undefined;
    }
  }
  return { code, out, err, fetchImpl, evidence };
}

const BASE_URL = 'https://api.example.com';

const HEALTHY_DEEP = {
  status: 200,
  body: { status: 'healthy', checks: { database: { status: 'pass' } } },
};
const OK_SUBSCRIPTION = { status: 200, body: { tier: 'starter' } };

test('probeEndpoint: returns ok for a 2xx JSON response', async () => {
  const fetchImpl = makeFetch({
    'https://api.example.com/health?deep=true': {
      status: 200,
      body: { status: 'healthy', checks: { database: { status: 'pass' } } },
    },
  });
  const result = await probeEndpoint('https://api.example.com', '/health?deep=true', {
    timeoutMs: 5000,
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.body.checks.database.status, 'pass');
});

test('probeEndpoint: returns ok=false for a 5xx response', async () => {
  const fetchImpl = makeFetch({
    'https://api.example.com/api/subscription/current': { status: 500, body: { error: 'oops' } },
  });
  const result = await probeEndpoint('https://api.example.com', '/api/subscription/current', {
    timeoutMs: 5000,
    fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
});

test('probeEndpoint: captures network errors with status null', async () => {
  const fetchImpl = async () => {
    throw new Error('ECONNREFUSED');
  };
  const result = await probeEndpoint('https://api.example.com', '/health', {
    timeoutMs: 5000,
    fetchImpl,
  });
  assert.equal(result.status, null);
  assert.equal(result.ok, false);
  assert.match(result.error, /ECONNREFUSED/);
});

test('evaluateProbe: passes for a healthy 2xx within latency budget', () => {
  const verdict = evaluateProbe(
    {
      path: '/health?deep=true',
      status: 200,
      ok: true,
      latencyMs: 120,
      body: { checks: { database: { status: 'pass' } } },
    },
    5000,
  );
  assert.equal(verdict.passed, true);
  assert.deepEqual(verdict.failures, []);
});

test('evaluateProbe: fails when DB readiness check is not pass', () => {
  const verdict = evaluateProbe(
    {
      path: '/health?deep=true',
      status: 200,
      ok: true,
      latencyMs: 120,
      body: { checks: { database: { status: 'fail', error: 'connection refused' } } },
    },
    5000,
  );
  assert.equal(verdict.passed, false);
  assert.match(verdict.failures.join(';'), /database readiness/);
});

test('evaluateProbe: fails when DB readiness check is missing entirely', () => {
  const verdict = evaluateProbe(
    { path: '/health?deep=true', status: 200, ok: true, latencyMs: 120, body: { checks: {} } },
    5000,
  );
  assert.equal(verdict.passed, false);
  assert.match(verdict.failures.join(';'), /missing/);
});

test('evaluateProbe: fails on latency budget exceeded', () => {
  const verdict = evaluateProbe(
    {
      path: '/api/subscription/current',
      status: 200,
      ok: true,
      latencyMs: 6000,
      body: {},
    },
    5000,
  );
  assert.equal(verdict.passed, false);
  assert.match(verdict.failures.join(';'), /latency 6000ms exceeds budget 5000ms/);
});

test('evaluateProbe: fails on non-2xx status', () => {
  const verdict = evaluateProbe(
    { path: '/api/subscription/current', status: 503, ok: false, latencyMs: 100, body: {} },
    5000,
  );
  assert.equal(verdict.passed, false);
  assert.match(verdict.failures.join(';'), /non-2xx status: 503/);
});

test('main: exits 0 when all endpoints pass', async () => {
  const { code, evidence } = await runMain(
    {
      [`${BASE_URL}/health?deep=true`]: HEALTHY_DEEP,
      [`${BASE_URL}/api/subscription/current`]: OK_SUBSCRIPTION,
    },
    { SMOKE_TARGET_URL: BASE_URL },
  );
  assert.equal(code, 0);
  assert.equal(evidence.summary.passed, 2);
  assert.equal(evidence.summary.failed, 0);
});

test('main: exits 1 when an endpoint returns 5xx', async () => {
  const { code, err } = await runMain(
    {
      [`${BASE_URL}/health?deep=true`]: HEALTHY_DEEP,
      [`${BASE_URL}/api/subscription/current`]: { status: 500, body: { error: 'db' } },
    },
    { SMOKE_TARGET_URL: BASE_URL },
  );
  assert.equal(code, 1);
  assert.match(err, /Smoke test failed for \/api\/subscription\/current/);
});

test('main: exits 1 when DB readiness check fails on /health?deep=true', async () => {
  const { code, err } = await runMain(
    {
      [`${BASE_URL}/health?deep=true`]: {
        status: 200,
        body: { status: 'degraded', checks: { database: { status: 'fail', error: 'timeout' } } },
      },
      [`${BASE_URL}/api/subscription/current`]: { status: 200, body: {} },
    },
    { SMOKE_TARGET_URL: BASE_URL },
  );
  assert.equal(code, 1);
  assert.match(err, /database readiness/);
});

test('main: throws when SMOKE_TARGET_URL is missing', async () => {
  await assert.rejects(main({}, { fetch: makeFetch({}) }), /SMOKE_TARGET_URL is required/);
});

test('main: respects custom SMOKE_ENDPOINTS', async () => {
  const { code, evidence } = await runMain(
    { [`${BASE_URL}/health`]: { status: 200, body: { status: 'healthy' } } },
    { SMOKE_TARGET_URL: BASE_URL, SMOKE_ENDPOINTS: '/health' },
  );
  assert.equal(code, 0);
  assert.equal(evidence.summary.total, 1);
});

test('DEFAULT_ENDPOINTS includes the deep health and subscription current paths', () => {
  assert.ok(DEFAULT_ENDPOINTS.includes('/health?deep=true'));
  assert.ok(DEFAULT_ENDPOINTS.includes('/api/subscription/current'));
});

test('ENDPOINT_EXPECTATIONS requires DB readiness for /health?deep=true', () => {
  assert.equal(ENDPOINT_EXPECTATIONS['/health?deep=true'].requireDbReady, true);
});

test('probeEndpoint: attaches Authorization: Bearer header when authToken is provided', async () => {
  const fetchImpl = makeFetch({
    'https://api.example.com/api/subscription/current': { status: 200, body: { tier: 'starter' } },
  });
  await probeEndpoint('https://api.example.com', '/api/subscription/current', {
    timeoutMs: 5000,
    fetchImpl,
    authToken: 'test-token-123',
  });
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].opts.headers.Authorization, 'Bearer test-token-123');
});

test('probeEndpoint: does NOT attach Authorization header when authToken is absent', async () => {
  const fetchImpl = makeFetch({
    'https://api.example.com/health?deep=true': {
      status: 200,
      body: { status: 'healthy', checks: { database: { status: 'pass' } } },
    },
  });
  await probeEndpoint('https://api.example.com', '/health?deep=true', {
    timeoutMs: 5000,
    fetchImpl,
  });
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(
    fetchImpl.calls[0].opts.headers.Authorization,
    undefined,
    'Authorization must not be set when no authToken is provided',
  );
});

test('probeEndpoint: attaches the WAF bypass header when a secret is provided', async () => {
  const fetchImpl = makeFetch({
    'https://api.example.com/health?deep=true': {
      status: 200,
      body: { status: 'healthy', checks: { database: { status: 'pass' } } },
    },
  });
  await probeEndpoint('https://api.example.com', '/health?deep=true', {
    timeoutMs: 5000,
    fetchImpl,
    wafBypassSecret: 'shhh-canary',
    wafBypassHeader: 'x-canary-secret',
  });
  assert.equal(fetchImpl.calls[0].opts.headers['x-canary-secret'], 'shhh-canary');
});

test('probeEndpoint: does NOT attach the WAF bypass header when the secret is absent', async () => {
  const fetchImpl = makeFetch({
    'https://api.example.com/health?deep=true': {
      status: 200,
      body: { status: 'healthy', checks: { database: { status: 'pass' } } },
    },
  });
  await probeEndpoint('https://api.example.com', '/health?deep=true', {
    timeoutMs: 5000,
    fetchImpl,
    wafBypassHeader: 'x-canary-secret',
  });
  assert.equal(
    fetchImpl.calls[0].opts.headers['x-canary-secret'],
    undefined,
    'the bypass header must be omitted when no secret is configured',
  );
});

test('main: sends the WAF bypass header on all probes when CANARY_WAF_SECRET is set', async () => {
  const { code, fetchImpl } = await runMain(
    {
      [`${BASE_URL}/health?deep=true`]: HEALTHY_DEEP,
      [`${BASE_URL}/api/subscription/current`]: OK_SUBSCRIPTION,
    },
    {
      SMOKE_TARGET_URL: BASE_URL,
      SMOKE_AUTH_TOKEN: 'prod-smoke-token',
      CANARY_WAF_SECRET: 'edge-pass',
    },
  );
  assert.equal(code, 0);
  assert.equal(fetchImpl.calls.length, 2);
  for (const call of fetchImpl.calls) {
    assert.equal(call.opts.headers['x-canary-secret'], 'edge-pass');
  }
});

test('main: sends Authorization header on all probes when SMOKE_AUTH_TOKEN is set', async () => {
  const { code, fetchImpl, evidence } = await runMain(
    {
      [`${BASE_URL}/health?deep=true`]: HEALTHY_DEEP,
      [`${BASE_URL}/api/subscription/current`]: OK_SUBSCRIPTION,
    },
    { SMOKE_TARGET_URL: BASE_URL, SMOKE_AUTH_TOKEN: 'prod-smoke-token' },
  );
  assert.equal(code, 0);
  assert.equal(fetchImpl.calls.length, 2);
  for (const call of fetchImpl.calls) {
    assert.equal(call.opts.headers.Authorization, 'Bearer prod-smoke-token');
  }
  assert.equal(evidence.authenticated, true);
});

test('main: evidence.authenticated is false when SMOKE_AUTH_TOKEN is unset', async () => {
  const { code, evidence } = await runMain(
    {
      [`${BASE_URL}/health?deep=true`]: HEALTHY_DEEP,
      [`${BASE_URL}/api/subscription/current`]: { status: 200, body: {} },
    },
    { SMOKE_TARGET_URL: BASE_URL },
  );
  assert.equal(code, 0);
  assert.equal(evidence.authenticated, false);
});

test('main: authenticated probe against /api/subscription/current passes with 2xx', async () => {
  const { code } = await runMain(
    {
      [`${BASE_URL}/health?deep=true`]: HEALTHY_DEEP,
      [`${BASE_URL}/api/subscription/current`]: OK_SUBSCRIPTION,
    },
    { SMOKE_TARGET_URL: BASE_URL, SMOKE_AUTH_TOKEN: 'token' },
  );
  assert.equal(code, 0);
});

test('main: unauthenticated probe against /api/subscription/current fails on 401 (not treated as success)', async () => {
  const { code, err } = await runMain(
    {
      [`${BASE_URL}/health?deep=true`]: HEALTHY_DEEP,
      [`${BASE_URL}/api/subscription/current`]: { status: 401, body: { error: 'unauthorized' } },
    },
    { SMOKE_TARGET_URL: BASE_URL },
  );
  assert.equal(code, 1);
  assert.match(err, /non-2xx status: 401/);
});
