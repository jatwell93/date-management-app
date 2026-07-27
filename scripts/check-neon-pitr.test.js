const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractSnapshots,
  filterSnapshotsByBranch,
  evaluatePitrReadiness,
  main,
  DEFAULT_MAX_AGE_HOURS,
} = require('./check-neon-pitr.js');

const NOW = new Date('2026-07-25T12:00:00Z');
const withinHours = (h) => new Date(NOW.getTime() - h * 60 * 60 * 1000);
const aheadHours = (h) => new Date(NOW.getTime() + h * 60 * 60 * 1000);

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

const SNAPSHOTS_URL = (p) => `https://console.neon.tech/api/v2/projects/${p}/snapshots`;
const BRANCHES_URL = (p, b) =>
  `https://console.neon.tech/api/v2/projects/${p}/branches?search=${b}`;

test('extractSnapshots handles { snapshots: [...] } shape and sorts newest-first', () => {
  const out = extractSnapshots({
    snapshots: [
      { id: 's1', created_at: '2026-07-25T10:00:00Z', branch_id: 'br-main' },
      { id: 's2', created_at: '2026-07-25T11:00:00Z', branch_id: 'br-main' },
    ],
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 's2');
  assert.equal(out[1].id, 's1');
  assert.equal(out[0].branchId, 'br-main');
});

test('extractSnapshots handles bare array shape', () => {
  const out = extractSnapshots([{ id: 's1', created_at: '2026-07-25T10:00:00Z' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 's1');
  assert.equal(out[0].branchId, undefined);
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

test('filterSnapshotsByBranch: keeps only snapshots matching the branch ID', () => {
  const snapshots = [
    { id: 's1', createdAt: withinHours(1), branchId: 'br-main' },
    { id: 's2', createdAt: withinHours(2), branchId: 'br-dev' },
    { id: 's3', createdAt: withinHours(3), branchId: 'br-main' },
    { id: 's4', createdAt: withinHours(4), branchId: undefined },
  ];
  const filtered = filterSnapshotsByBranch(snapshots, 'br-main');
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].id, 's1');
  assert.equal(filtered[1].id, 's3');
});

test('filterSnapshotsByBranch: excludes snapshots without a branch_id', () => {
  const snapshots = [
    { id: 's1', createdAt: withinHours(1), branchId: undefined },
    { id: 's2', createdAt: withinHours(2) },
  ];
  const filtered = filterSnapshotsByBranch(snapshots, 'br-main');
  assert.equal(filtered.length, 0);
});

test('filterSnapshotsByBranch: returns empty array when no snapshots match', () => {
  const snapshots = [{ id: 's1', createdAt: withinHours(1), branchId: 'br-dev' }];
  const filtered = filterSnapshotsByBranch(snapshots, 'br-main');
  assert.deepEqual(filtered, []);
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

test('evaluatePitrReadiness: rejects future timestamps (negative age) as not ready', () => {
  const snapshots = [{ id: 's1', createdAt: aheadHours(1) }];
  const verdict = evaluatePitrReadiness(snapshots, 2, NOW);
  assert.equal(verdict.ready, false);
  assert.equal(verdict.newestAgeHours, -1);
  assert.match(verdict.reason || '', /in the future/);
});

test('main: exits 0 when a recent restore point exists for the target branch', async () => {
  const outChunks = [];
  const errChunks = [];
  const fetchImpl = makeFetch({
    [BRANCHES_URL('proj-123', 'main')]: {
      branches: [{ id: 'br-main', name: 'main', deleted: false }],
    },
    [SNAPSHOTS_URL('proj-123')]: {
      snapshots: [{ id: 's1', created_at: withinHours(0.5).toISOString(), branch_id: 'br-main' }],
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
  assert.equal(evidence.branchSnapshotCount, 1);
});

test('main: exits 1 when no restore points exist for the target branch', async () => {
  const outChunks = [];
  const errChunks = [];
  const fetchImpl = makeFetch({
    [BRANCHES_URL('proj-123', 'main')]: {
      branches: [{ id: 'br-main', name: 'main', deleted: false }],
    },
    [SNAPSHOTS_URL('proj-123')]: { snapshots: [] },
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
  assert.match(errChunks.join(''), /No Neon restore points found for branch "main"/);
});

test('main: exits 1 when newest restore point for the target branch is too old', async () => {
  const outChunks = [];
  const errChunks = [];
  const fetchImpl = makeFetch({
    [BRANCHES_URL('proj-123', 'main')]: {
      branches: [{ id: 'br-main', name: 'main', deleted: false }],
    },
    [SNAPSHOTS_URL('proj-123')]: {
      snapshots: [{ id: 's1', created_at: withinHours(10).toISOString(), branch_id: 'br-main' }],
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

test('main: cross-branch — recent dev snapshot does NOT satisfy gate when production snapshot is stale', async () => {
  // A recent snapshot belongs to a dev branch, but the production (main)
  // branch's only snapshot is 10h old. The gate must fail because we filter
  // by branch_id and evaluate only the production branch's snapshots.
  const outChunks = [];
  const errChunks = [];
  const fetchImpl = makeFetch({
    [BRANCHES_URL('proj-123', 'main')]: {
      branches: [{ id: 'br-main', name: 'main', deleted: false }],
    },
    [SNAPSHOTS_URL('proj-123')]: {
      snapshots: [
        // Recent dev-branch snapshot — must NOT satisfy the gate for main
        { id: 's-dev-recent', created_at: withinHours(0.5).toISOString(), branch_id: 'br-dev' },
        // Stale production snapshot — this is what should be evaluated
        { id: 's-main-stale', created_at: withinHours(10).toISOString(), branch_id: 'br-main' },
      ],
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
  const evidence = JSON.parse(outChunks.join(''));
  assert.equal(evidence.ready, false);
  assert.equal(evidence.snapshotCount, 2);
  assert.equal(evidence.branchSnapshotCount, 1);
  assert.equal(evidence.newestAgeHours, 10);
  assert.match(errChunks.join(''), /10h old.*threshold 2h/);
});

test('main: cross-branch — fails when production branch has NO snapshots but dev branch has recent ones', async () => {
  const outChunks = [];
  const errChunks = [];
  const fetchImpl = makeFetch({
    [BRANCHES_URL('proj-123', 'main')]: {
      branches: [{ id: 'br-main', name: 'main', deleted: false }],
    },
    [SNAPSHOTS_URL('proj-123')]: {
      snapshots: [
        { id: 's-dev-recent', created_at: withinHours(0.5).toISOString(), branch_id: 'br-dev' },
      ],
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
  const evidence = JSON.parse(outChunks.join(''));
  assert.equal(evidence.ready, false);
  assert.equal(evidence.snapshotCount, 1);
  assert.equal(evidence.branchSnapshotCount, 0);
  assert.match(errChunks.join(''), /No Neon restore points found for branch "main"/);
});

test('main: fails closed (exit 1) when the target branch cannot be resolved', async () => {
  const outChunks = [];
  const errChunks = [];
  const fetchImpl = makeFetch({
    [BRANCHES_URL('proj-123', 'main')]: { branches: [] },
    [SNAPSHOTS_URL('proj-123')]: {
      snapshots: [{ id: 's1', created_at: withinHours(0.5).toISOString(), branch_id: 'br-other' }],
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
  const evidence = JSON.parse(outChunks.join(''));
  assert.equal(evidence.ready, false);
  assert.equal(evidence.branch.id, null);
  assert.match(evidence.reason, /could not be resolved/);
  assert.match(errChunks.join(''), /Could not resolve Neon branch "main"/);
  // Must NOT have fetched snapshots if the branch could not be resolved
  assert.equal(
    fetchImpl.calls.some((u) => u.includes('/snapshots')),
    false,
    'Snapshots must not be fetched before the branch is resolved',
  );
});

test('main: rejects future timestamps for the target branch (fail closed)', async () => {
  const outChunks = [];
  const errChunks = [];
  const fetchImpl = makeFetch({
    [BRANCHES_URL('proj-123', 'main')]: {
      branches: [{ id: 'br-main', name: 'main', deleted: false }],
    },
    [SNAPSHOTS_URL('proj-123')]: {
      snapshots: [
        { id: 's-future', created_at: aheadHours(1).toISOString(), branch_id: 'br-main' },
      ],
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
  const evidence = JSON.parse(outChunks.join(''));
  assert.equal(evidence.ready, false);
  assert.equal(evidence.newestAgeHours, -1);
  assert.match(evidence.reason, /in the future/);
  assert.match(errChunks.join(''), /in the future/);
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

test('main: exits 1 on Neon API error (branches endpoint)', async () => {
  const errChunks = [];
  const fetchImpl = async (url) => {
    if (url.includes('/branches')) {
      return { ok: false, status: 401, text: async () => 'unauthorized', json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({ snapshots: [] }), text: async () => '{}' };
  };
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

test('main: exits 1 on Neon API error (snapshots endpoint)', async () => {
  const errChunks = [];
  const fetchImpl = async (url) => {
    if (url.includes('/branches')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ branches: [{ id: 'br-main', name: 'main', deleted: false }] }),
        text: async () => '{}',
      };
    }
    return { ok: false, status: 500, text: async () => 'server error', json: async () => ({}) };
  };
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
    /returned 500/,
  );
});
