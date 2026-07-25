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
  return async (url) => {
    const entry = responses[url];
    if (!entry) throw new Error(`unexpected fetch ${url}`);
    if (entry instanceof Error) throw entry;
    return makeResponse(entry.status, entry.body, entry.contentType);
  };
}

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
  const outChunks = [];
  const errChunks = [];
  const fetchImpl = makeFetch({
    'https://api.example.com/health?deep=true': {
      status: 200,
      body: { status: 'healthy', checks: { database: { status: 'pass' } } },
    },
    'https://api.example.com/api/subscription/current': { status: 200, body: { tier: 'starter' } },
  });
  const code = await main(
    { SMOKE_TARGET_URL: 'https://api.example.com' },
    {
      fetch: fetchImpl,
      stdout: { write: (s) => outChunks.push(s) },
      stderr: { write: (s) => errChunks.push(s) },
    },
  );
  assert.equal(code, 0);
  const evidence = JSON.parse(outChunks.join(''));
  assert.equal(evidence.summary.passed, 2);
  assert.equal(evidence.summary.failed, 0);
});

test('main: exits 1 when an endpoint returns 5xx', async () => {
  const outChunks = [];
  const errChunks = [];
  const fetchImpl = makeFetch({
    'https://api.example.com/health?deep=true': {
      status: 200,
      body: { status: 'healthy', checks: { database: { status: 'pass' } } },
    },
    'https://api.example.com/api/subscription/current': { status: 500, body: { error: 'db' } },
  });
  const code = await main(
    { SMOKE_TARGET_URL: 'https://api.example.com' },
    {
      fetch: fetchImpl,
      stdout: { write: (s) => outChunks.push(s) },
      stderr: { write: (s) => errChunks.push(s) },
    },
  );
  assert.equal(code, 1);
  assert.match(errChunks.join(''), /Smoke test failed for \/api\/subscription\/current/);
});

test('main: exits 1 when DB readiness check fails on /health?deep=true', async () => {
  const outChunks = [];
  const errChunks = [];
  const fetchImpl = makeFetch({
    'https://api.example.com/health?deep=true': {
      status: 200,
      body: { status: 'degraded', checks: { database: { status: 'fail', error: 'timeout' } } },
    },
    'https://api.example.com/api/subscription/current': { status: 200, body: {} },
  });
  const code = await main(
    { SMOKE_TARGET_URL: 'https://api.example.com' },
    {
      fetch: fetchImpl,
      stdout: { write: (s) => outChunks.push(s) },
      stderr: { write: (s) => errChunks.push(s) },
    },
  );
  assert.equal(code, 1);
  assert.match(errChunks.join(''), /database readiness/);
});

test('main: throws when SMOKE_TARGET_URL is missing', async () => {
  await assert.rejects(main({}, { fetch: makeFetch({}) }), /SMOKE_TARGET_URL is required/);
});

test('main: respects custom SMOKE_ENDPOINTS', async () => {
  const outChunks = [];
  const fetchImpl = makeFetch({
    'https://api.example.com/health': { status: 200, body: { status: 'healthy' } },
  });
  const code = await main(
    { SMOKE_TARGET_URL: 'https://api.example.com', SMOKE_ENDPOINTS: '/health' },
    {
      fetch: fetchImpl,
      stdout: { write: (s) => outChunks.push(s) },
      stderr: { write: () => {} },
    },
  );
  assert.equal(code, 0);
  const evidence = JSON.parse(outChunks.join(''));
  assert.equal(evidence.summary.total, 1);
});

test('DEFAULT_ENDPOINTS includes the deep health and subscription current paths', () => {
  assert.ok(DEFAULT_ENDPOINTS.includes('/health?deep=true'));
  assert.ok(DEFAULT_ENDPOINTS.includes('/api/subscription/current'));
});

test('ENDPOINT_EXPECTATIONS requires DB readiness for /health?deep=true', () => {
  assert.equal(ENDPOINT_EXPECTATIONS['/health?deep=true'].requireDbReady, true);
});
