const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractSnapshots,
  evaluatePitrReadiness,
  main,
  DEFAULT_MAX_AGE_HOURS,
} = require('./check-neon-pitr.js');

const NOW = new Date('2026-07-25T12:00:00Z');
const withinHours = (h) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

function makeFetch(responses) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const entry = responses[url];
    if (!entry) {
      return { ok: false, status: 404, text: async () => 'not found', json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => entry,
      text: async () => JSON.stringify(entry),
    };
  };
  fn.calls = calls;
  return fn;
}

test('extractSnapshots handles { snapshots: [...] } shape and sorts newest-first', () => {
  const out = extractSnapshots({
    snapshots: [
      { id: 's1', created_at: '2026-07-25T10:00:00Z' },
      { id: 's2', created_at: '2026-07-25T11:00:00Z' },
    ],
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 's2');
  assert.equal(out[1].id, 's1');
});

test('extractSnapshots handles bare array shape', () => {
  const out = extractSnapshots([{ id: 's1', created_at: '2026-07-25T10:00:00Z' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 's1');
});

test('extractSnapshots skips entries with missing or invalid timestamps', () => {
  const out = extractSnapshots({
    snapshots: [
      { id: 's1', created_at: 'not-a-date' },
      { id: 's2' },
      { id: 's3', created_at: '2026-07-25T10:00:00Z' },
      null,
      'string',
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 's3');
});

test('extractSnapshots returns empty array for unexpected payload shapes', () => {
  assert.deepEqual(extractSnapshots(null), []);
  assert.deepEqual(extractSnapshots({}), []);
  assert.deepEqual(extractSnapshots({ snapshots: 'not-an-array' }), []);
});

test('evaluatePitrReadiness: ready when newest snapshot is within threshold', () => {
  const snapshots = [{ id: 's1', createdAt: withinHours(1) }];
  const verdict = evaluatePitrReadiness(snapshots, DEFAULT_MAX_AGE_HOURS, NOW);
  assert.equal(verdict.ready, true);
  assert.equal(verdict.newestAgeHours, 1);
});

test('evaluatePitrReadiness: not ready when newest snapshot exceeds threshold', () => {
  const snapshots = [{ id: 's1', createdAt: withinHours(5) }];
  const verdict = evaluatePitrReadiness(snapshots, 2, NOW);
  assert.equal(verdict.ready, false);
  assert.equal(verdict.newestAgeHours, 5);
});

test('evaluatePitrReadiness: not ready when no snapshots exist', () => {
  const verdict = evaluatePitrReadiness([], 2, NOW);
  assert.equal(verdict.ready, false);
  assert.equal(verdict.newestAgeHours, null);
  assert.equal(verdict.newest, null);
});

test('main: exits 0 when a recent restore point exists', async () => {
  const outChunks = [];
  const errChunks = [];
  const fetchImpl = makeFetch({
    'https://console.neon.tech/api/v2/projects/proj-123/snapshots': {
      snapshots: [{ id: 's1', created_at: withinHours(0.5).toISOString() }],
    },
    'https://console.neon.tech/api/v2/projects/proj-123/branches?search=main': {
      branches: [{ id: 'br-main', name: 'main', deleted: false }],
    },
  });
  const code = await main(
    { NEON_API_KEY: 'key', NEON_PROJECT_ID: 'proj-123' },
    {
      fetch: fetchImpl,
      now: () => NOW,
      stdout: { write: (s) => outChunks.push(s) },
      stderr: { write: (s) => errChunks.push(s) },
    },
  );
  assert.equal(code, 0);
  const evidence = JSON.parse(outChunks.join(''));
  assert.equal(evidence.ready, true);
  assert.equal(evidence.projectId, 'proj-123');
  assert.equal(evidence.branch.id, 'br-main');
});

test('main: exits 1 when no restore points exist', async () => {
  const outChunks = [];
  const errChunks = [];
  const fetchImpl = makeFetch({
    'https://console.neon.tech/api/v2/projects/proj-123/snapshots': { snapshots: [] },
    'https://console.neon.tech/api/v2/projects/proj-123/branches?search=main': {
      branches: [{ id: 'br-main', name: 'main', deleted: false }],
    },
  });
  const code = await main(
    { NEON_API_KEY: 'key', NEON_PROJECT_ID: 'proj-123' },
    {
      fetch: fetchImpl,
      now: () => NOW,
      stdout: { write: (s) => outChunks.push(s) },
      stderr: { write: (s) => errChunks.push(s) },
    },
  );
  assert.equal(code, 1);
  assert.match(errChunks.join(''), /No Neon restore points found/);
});

test('main: exits 1 when newest restore point is too old', async () => {
  const outChunks = [];
  const errChunks = [];
  const fetchImpl = makeFetch({
    'https://console.neon.tech/api/v2/projects/proj-123/snapshots': {
      snapshots: [{ id: 's1', created_at: withinHours(10).toISOString() }],
    },
    'https://console.neon.tech/api/v2/projects/proj-123/branches?search=main': {
      branches: [{ id: 'br-main', name: 'main', deleted: false }],
    },
  });
  const code = await main(
    { NEON_API_KEY: 'key', NEON_PROJECT_ID: 'proj-123', PITR_MAX_AGE_HOURS: '2' },
    {
      fetch: fetchImpl,
      now: () => NOW,
      stdout: { write: (s) => outChunks.push(s) },
      stderr: { write: (s) => errChunks.push(s) },
    },
  );
  assert.equal(code, 1);
  assert.match(errChunks.join(''), /10h old.*threshold 2h/);
});

test('main: throws when NEON_API_KEY is missing', async () => {
  await assert.rejects(
    main({ NEON_PROJECT_ID: 'proj-123' }, { fetch: makeFetch({}), now: () => NOW }),
    /NEON_API_KEY is required/,
  );
});

test('main: throws when NEON_PROJECT_ID is missing', async () => {
  await assert.rejects(
    main({ NEON_API_KEY: 'key' }, { fetch: makeFetch({}), now: () => NOW }),
    /NEON_PROJECT_ID is required/,
  );
});

test('main: throws when PITR_MAX_AGE_HOURS is invalid', async () => {
  await assert.rejects(
    main(
      { NEON_API_KEY: 'key', NEON_PROJECT_ID: 'proj-123', PITR_MAX_AGE_HOURS: 'not-a-number' },
      { fetch: makeFetch({}), now: () => NOW },
    ),
    /PITR_MAX_AGE_HOURS must be a positive number/,
  );
});

test('main: exits 1 on Neon API error', async () => {
  const errChunks = [];
  const fetchImpl = async (_url) => ({
    ok: false,
    status: 401,
    text: async () => 'unauthorized',
    json: async () => ({}),
  });
  await assert.rejects(
    main(
      { NEON_API_KEY: 'bad', NEON_PROJECT_ID: 'proj-123' },
      {
        fetch: fetchImpl,
        now: () => NOW,
        stdout: { write: () => {} },
        stderr: { write: (s) => errChunks.push(s) },
      },
    ),
    /returned 401/,
  );
});
