const test = require('node:test');
const assert = require('node:assert/strict');

const { pickSnapshotToEvict, defaultSnapshotName, main } = require('./create-neon-snapshot.js');

const PROJECT = 'proj-123';
const BRANCH_ID = 'br-prod';
const BASE = `https://console.neon.tech/api/v2/projects/${PROJECT}`;
const BRANCHES_URL = `${BASE}/branches?search=production`;
const SNAPSHOTS_URL = `${BASE}/snapshots`;
const SNAPSHOT_URL = (name) => `${BASE}/branches/${BRANCH_ID}/snapshot?name=${name}`;

const NOW = new Date('2026-09-17T02:58:27Z');
const ENV = {
  NEON_API_KEY: 'key',
  NEON_PROJECT_ID: PROJECT,
  SNAPSHOT_NAME: 'pre-migration-test',
};

/**
 * Stub fetch driven by a url -> handler map. Handlers may be a plain payload
 * (200) or {status, body} for a failure; a function is called with the attempt
 * count so a test can make the same URL fail then succeed, which is the whole
 * shape of the quota-eviction path.
 */
const failWith = (status, body) => ({
  ok: false,
  status,
  text: async () => body,
  json: async () => ({}),
});

const succeedWith = (payload) => ({
  ok: true,
  status: 200,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
});

/** Resolve one route entry to a Response-alike. */
function respond(entry) {
  if (!entry) return failWith(404, 'not found');
  if (entry.status && entry.status >= 400) return failWith(entry.status, entry.body || '');
  return succeedWith(entry);
}

function makeFetch(routes) {
  const calls = [];
  const counts = new Map();
  const fn = async (url, init) => {
    calls.push({ url, method: init?.method || 'GET' });
    const n = (counts.get(url) || 0) + 1;
    counts.set(url, n);
    const route = routes[url];
    return respond(typeof route === 'function' ? route(n) : route);
  };
  fn.calls = calls;
  return fn;
}

const BRANCH_OK = { branches: [{ id: BRANCH_ID, name: 'production' }] };
const sink = () => ({ write() {} });

function run(fetchImpl, env = ENV) {
  return main(env, { fetch: fetchImpl, now: () => NOW, stdout: sink(), stderr: sink() });
}

test('defaultSnapshotName matches the pitr-drill.sh stamp format', () => {
  assert.equal(defaultSnapshotName(NOW), 'pre-migration-20260917025827');
});

test('creates a recovery point and does not touch existing snapshots', async () => {
  const fetchImpl = makeFetch({
    [BRANCHES_URL]: BRANCH_OK,
    [SNAPSHOT_URL('pre-migration-test')]: { snapshot: { id: 'snap-new' } },
  });
  assert.equal(await run(fetchImpl), 0);
  // The whole point of "only after a failure": no list, no delete.
  assert.equal(
    fetchImpl.calls.filter((c) => c.method === 'DELETE').length,
    0,
    'must not delete a restore point when creation succeeded',
  );
  assert.equal(fetchImpl.calls.filter((c) => c.url === SNAPSHOTS_URL).length, 0);
});

test('422 quota: evicts the oldest snapshot for the branch, then retries once', async () => {
  const fetchImpl = makeFetch({
    [BRANCHES_URL]: BRANCH_OK,
    [SNAPSHOT_URL('pre-migration-test')]: (n) =>
      n === 1 ? { status: 422, body: 'quota exceeded' } : { snapshot: { id: 'snap-new' } },
    [SNAPSHOTS_URL]: {
      snapshots: [
        { id: 'snap-newer', created_at: '2026-08-07T03:52:22Z', branch_id: BRANCH_ID },
        { id: 'snap-oldest', created_at: '2026-07-01T00:00:00Z', branch_id: BRANCH_ID },
      ],
    },
    [`${BASE}/snapshots/snap-oldest`]: { deleted: true },
  });
  assert.equal(await run(fetchImpl), 0);
  const deletes = fetchImpl.calls.filter((c) => c.method === 'DELETE');
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].url, `${BASE}/snapshots/snap-oldest`);
  assert.equal(fetchImpl.calls.filter((c) => c.url.includes('/snapshot?name=')).length, 2);
});

test('a non-quota failure never deletes a restore point', async () => {
  const fetchImpl = makeFetch({
    [BRANCHES_URL]: BRANCH_OK,
    [SNAPSHOT_URL('pre-migration-test')]: { status: 401, body: 'unauthorized' },
  });
  assert.equal(await run(fetchImpl), 1);
  assert.equal(
    fetchImpl.calls.filter((c) => c.method === 'DELETE').length,
    0,
    'deleting a restore point cannot fix a 401 and must not be attempted',
  );
});

test('SNAPSHOT_REPLACE=false leaves the quota alone and fails closed', async () => {
  const fetchImpl = makeFetch({
    [BRANCHES_URL]: BRANCH_OK,
    [SNAPSHOT_URL('pre-migration-test')]: { status: 422, body: 'quota exceeded' },
  });
  assert.equal(await run(fetchImpl, { ...ENV, SNAPSHOT_REPLACE: 'false' }), 1);
  assert.equal(fetchImpl.calls.filter((c) => c.method === 'DELETE').length, 0);
});

test('fails closed when the branch does not exist', async () => {
  const fetchImpl = makeFetch({ [BRANCHES_URL]: { branches: [] } });
  assert.equal(await run(fetchImpl), 1);
});

test('a failed retry after eviction still fails closed', async () => {
  const fetchImpl = makeFetch({
    [BRANCHES_URL]: BRANCH_OK,
    [SNAPSHOT_URL('pre-migration-test')]: { status: 422, body: 'quota exceeded' },
    [SNAPSHOTS_URL]: {
      snapshots: [{ id: 'snap-oldest', created_at: '2026-07-01T00:00:00Z', branch_id: BRANCH_ID }],
    },
    [`${BASE}/snapshots/snap-oldest`]: { deleted: true },
  });
  assert.equal(await run(fetchImpl), 1);
});

test('pickSnapshotToEvict prefers the oldest on the target branch', () => {
  const victim = pickSnapshotToEvict(
    [
      { id: 'other-old', created_at: '2026-01-01T00:00:00Z', branch_id: 'br-dev' },
      { id: 'mine-new', created_at: '2026-08-01T00:00:00Z', branch_id: BRANCH_ID },
      { id: 'mine-old', created_at: '2026-07-01T00:00:00Z', branch_id: BRANCH_ID },
    ],
    BRANCH_ID,
  );
  assert.equal(victim.id, 'mine-old');
  assert.equal(victim.foreign, false, 'a snapshot on the target branch is not a foreign eviction');
});

test('pickSnapshotToEvict falls back to another branch and flags it as foreign', () => {
  const victim = pickSnapshotToEvict(
    [{ id: 'other-old', created_at: '2026-01-01T00:00:00Z', branch_id: 'br-dev' }],
    BRANCH_ID,
  );
  assert.equal(victim.id, 'other-old');
  assert.equal(victim.foreign, true, 'the quota is per-project, and this must be said out loud');
});

test('pickSnapshotToEvict returns null when there is nothing to evict', () => {
  assert.equal(pickSnapshotToEvict([], BRANCH_ID), null);
});

test('pickSnapshotToEvict reads source_branch_id as well as branch_id', () => {
  const victim = pickSnapshotToEvict(
    [{ id: 'mine', created_at: '2026-07-01T00:00:00Z', source_branch_id: BRANCH_ID }],
    BRANCH_ID,
  );
  assert.equal(victim.id, 'mine');
  assert.equal(victim.foreign, false);
});
