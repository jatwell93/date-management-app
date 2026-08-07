const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runChecks,
  buildQuery,
  loadNeonDriver,
  redactConnectionString,
  main,
  SUBSCRIPTION_CURRENT_SQL,
  SENTINEL_ORG_ID,
  EXPECTED_SUBSCRIPTION_COLUMNS,
  MIN_PUBLIC_TABLES,
} = require('./verify-app-against-branch.js');

const NOW = new Date('2026-08-07T09:00:00Z');

/**
 * Build a query stub that dispatches on a substring of the SQL text, so tests
 * describe behaviour ("the ledger returns no applied rows") rather than
 * depending on the order in which runChecks issues statements.
 */
function makeQuery(overrides = {}) {
  const calls = [];
  const defaults = {
    'SELECT 1': () => [{ ok: 1 }],
    "state = 'applied' ORDER BY id": () => [{ id: '0011', state: 'applied' }],
    "state <> 'applied'": () => [{ n: 0 }],
    'FROM subscription_tiers': () => [],
    'information_schema.columns': () =>
      EXPECTED_SUBSCRIPTION_COLUMNS.map((c) => ({ column_name: c })),
    'information_schema.tables': () => [{ n: 47 }],
    'FROM tier_feature_flags': () => [
      { tier_level: 'premium', feature_key: 'storage_bytes', limit_value: '107374182400' },
    ],
  };
  const table = { ...defaults, ...overrides };
  const fn = async (sql, params) => {
    calls.push({ sql, params });
    for (const [needle, handler] of Object.entries(table)) {
      if (sql.includes(needle)) return handler(params);
    }
    throw new Error(`unstubbed query: ${sql}`);
  };
  fn.calls = calls;
  return fn;
}

const byName = (checks) => Object.fromEntries(checks.map((c) => [c.name, c]));

test('all checks pass against a healthy, fully-migrated branch', async () => {
  const checks = await runChecks(makeQuery());
  assert.equal(checks.length, 6);
  assert.ok(
    checks.every((c) => c.pass),
    `expected all passes, got: ${JSON.stringify(checks.filter((c) => !c.pass))}`,
  );
});

test('subscription probe binds the sentinel org id, never a real one', async () => {
  const query = makeQuery();
  await runChecks(query);
  const call = query.calls.find((c) => c.sql.includes('FROM subscription_tiers'));
  assert.ok(call, 'expected the subscription query to run');
  assert.deepEqual(call.params, [SENTINEL_ORG_ID]);
});

test('the subscription probe uses the Worker handler column list verbatim', () => {
  for (const column of EXPECTED_SUBSCRIPTION_COLUMNS) {
    assert.ok(
      SUBSCRIPTION_CURRENT_SQL.includes(column),
      `expected ${column} in the subscription SQL`,
    );
  }
  assert.ok(SUBSCRIPTION_CURRENT_SQL.includes('ORDER BY created_at DESC'));
  assert.ok(SUBSCRIPTION_CURRENT_SQL.includes('LIMIT 1'));
});

test('a missing 0011 column fails the subscription check (pre-0011 restore)', async () => {
  const checks = await runChecks(
    makeQuery({
      'information_schema.columns': () =>
        EXPECTED_SUBSCRIPTION_COLUMNS.filter(
          (c) => c !== 'current_period_end' && c !== 'cancel_at_period_end',
        ).map((column_name) => ({ column_name })),
    }),
  );
  const check = byName(checks).subscription_current_columns;
  assert.equal(check.pass, false);
  assert.match(check.detail, /current_period_end/);
  assert.match(check.detail, /cancel_at_period_end/);
});

test('a throwing subscription query is reported as a failed check, not a crash', async () => {
  const checks = await runChecks(
    makeQuery({
      'FROM subscription_tiers': () => {
        throw new Error('column "current_period_end" does not exist');
      },
    }),
  );
  const check = byName(checks).subscription_current_columns;
  assert.equal(check.pass, false);
  assert.match(check.detail, /does not exist/);
});

test('a sentinel org that matches a row fails rather than reading tenant data', async () => {
  const checks = await runChecks(
    makeQuery({ 'FROM subscription_tiers': () => [{ status: 'active' }] }),
  );
  const check = byName(checks).subscription_current_columns;
  assert.equal(check.pass, false);
  assert.match(check.detail, /unexpectedly matched 1 row/);
});

test('an empty ledger fails ledger_head (pre-adoption or truncated restore)', async () => {
  const checks = await runChecks(makeQuery({ "state = 'applied' ORDER BY id": () => [] }));
  const check = byName(checks).ledger_head;
  assert.equal(check.pass, false);
  assert.match(check.detail, /no applied migration/);
});

test('an interrupted migration row fails ledger_no_interrupted', async () => {
  const checks = await runChecks(makeQuery({ "state <> 'applied'": () => [{ n: 2 }] }));
  const check = byName(checks).ledger_no_interrupted;
  assert.equal(check.pass, false);
  assert.match(check.detail, /2 row\(s\)/);
});

test('a readiness query returning the wrong shape fails', async () => {
  const checks = await runChecks(makeQuery({ 'SELECT 1': () => [] }));
  assert.equal(byName(checks).readiness.pass, false);
});

test('one failing check does not prevent the others from reporting', async () => {
  const checks = await runChecks(makeQuery({ 'SELECT 1': () => [] }));
  assert.equal(checks.length, 6, 'every check should still report');
  assert.equal(byName(checks).ledger_head.pass, true);
});

test('a near-empty public schema fails public_table_count (incomplete restore)', async () => {
  const checks = await runChecks(makeQuery({ 'information_schema.tables': () => [{ n: 1 }] }));
  const check = byName(checks).public_table_count;
  assert.equal(check.pass, false);
  assert.match(check.detail, new RegExp(`expected >= ${MIN_PUBLIC_TABLES}`));
});

test('public_table_count reports the table count on a healthy restore', async () => {
  const check = byName(await runChecks(makeQuery())).public_table_count;
  assert.equal(check.pass, true);
  assert.match(check.detail, /47 tables/);
});

test('int8 read records the driver-reported JS type', async () => {
  const checks = await runChecks(makeQuery());
  const check = byName(checks).tier_feature_flags_int8;
  assert.equal(check.pass, true);
  assert.match(check.detail, /js typeof: string/);
});

// Without this, the check would report success on a branch where the query
// matched nothing — asserting int8 compatibility it never actually exercised.
test('int8 check FAILS when no row exceeds int4 (read path never exercised)', async () => {
  const checks = await runChecks(makeQuery({ 'FROM tier_feature_flags': () => [] }));
  const check = byName(checks).tier_feature_flags_int8;
  assert.equal(check.pass, false);
  assert.match(check.detail, /never exercised/);
});

test('redactConnectionString never leaks the password, user, or full host', () => {
  const out = redactConnectionString(
    'postgres://neondb_owner:sup3rs3cret@ep-cool-name-12345.eu-central-1.aws.neon.tech/neondb',
  );
  assert.ok(!out.includes('sup3rs3cret'));
  assert.ok(!out.includes('neondb_owner'));
  assert.ok(!out.includes('cool-name-12345'));
  assert.match(out, /REDACTED/);
  assert.match(out, /neon\.tech/);
});

test('redactConnectionString tolerates an unparseable value', () => {
  assert.equal(redactConnectionString('not a url'), '<unparseable-connection-string>');
  assert.equal(redactConnectionString(''), '<none>');
});

test('main exits 1 with no connection string and does not query', async () => {
  const stderr = [];
  const code = await main({}, { argv: [], stderr: { write: (s) => stderr.push(s) } });
  assert.equal(code, 1);
  assert.match(stderr.join(''), /--url/);
});

test('main reads --url and emits passing evidence without leaking the URL', async () => {
  const stdout = [];
  const code = await main(
    { VERIFY_LABEL: 'pitr-drill' },
    {
      argv: ['--url', 'postgres://u:p@ep-secret-host.aws.neon.tech/neondb'],
      query: makeQuery(),
      now: () => NOW,
      stdout: { write: (s) => stdout.push(s) },
      stderr: { write: () => {} },
    },
  );
  assert.equal(code, 0);
  const raw = stdout.join('');
  const evidence = JSON.parse(raw);
  assert.equal(evidence.pass, true);
  assert.equal(evidence.label, 'pitr-drill');
  assert.equal(evidence.checks.length, 6);
  assert.ok(!raw.includes('secret-host'), 'host must be redacted in evidence');
  assert.ok(!raw.includes(':p@'), 'password must never appear');
});

test('main falls back to VERIFY_DATABASE_URL and exits 1 when a check fails', async () => {
  const stdout = [];
  const code = await main(
    { VERIFY_DATABASE_URL: 'postgres://u:p@ep-x.aws.neon.tech/neondb' },
    {
      argv: [],
      query: makeQuery({ 'SELECT 1': () => [] }),
      now: () => NOW,
      stdout: { write: (s) => stdout.push(s) },
      stderr: { write: () => {} },
    },
  );
  assert.equal(code, 1);
  assert.equal(JSON.parse(stdout.join('')).pass, false);
});

// ---------------------------------------------------------------------------
// Driver adapter. neon() returns a TAGGED-TEMPLATE function; calling it as a
// plain function with $1 placeholders is rejected at runtime by
// @neondatabase/serverless v1. The first live drill run failed all six checks
// on exactly that, so the contract is pinned here rather than relying on a
// production drill to catch it again.
// ---------------------------------------------------------------------------

test('buildQuery routes through sql.query, not the tagged-template callable', async () => {
  const calls = [];
  const sql = Object.assign(
    () => {
      throw new Error(
        'This function can now be called only as a tagged-template function: sql`SELECT ${value}`',
      );
    },
    {
      query: async (text, params) => {
        calls.push({ text, params });
        return [{ ok: 1 }];
      },
    },
  );
  const query = buildQuery(sql);
  const rows = await query('SELECT $1 AS ok', ['x']);
  assert.deepEqual(rows, [{ ok: 1 }]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { text: 'SELECT $1 AS ok', params: ['x'] });
});

test('buildQuery passes an empty params array when none are supplied', async () => {
  const calls = [];
  const sql = { query: async (text, params) => (calls.push(params), []) };
  await buildQuery(sql)('SELECT 1');
  assert.deepEqual(calls[0], []);
});

test('buildQuery unwraps a { rows } envelope if the driver default changes', async () => {
  const sql = { query: async () => ({ rows: [{ n: 3 }], rowCount: 1 }) };
  assert.deepEqual(await buildQuery(sql)('SELECT 1'), [{ n: 3 }]);
});

test('buildQuery fails loudly when the driver stops exposing .query', () => {
  assert.throws(() => buildQuery(() => {}), /does not expose \.query/);
});

test('buildQuery rejects an unexpected result shape rather than crashing later', async () => {
  const sql = { query: async () => 'surprise' };
  await assert.rejects(() => buildQuery(sql)('SELECT 1'), /Unexpected result shape/);
});

test('the real driver client exposes the .query entry point buildQuery needs', () => {
  // Guards against a @neondatabase/serverless upgrade silently removing the
  // conventional entry point. Constructs a client but issues no query, so this
  // needs no database.
  const { neon } = loadNeonDriver();
  const client = neon('postgres://u:p@ep-fake.aws.neon.tech/neondb');
  assert.equal(typeof client.query, 'function');
});
