#!/usr/bin/env node
/**
 * Phase 1 task 1.9 — application verification against a database branch.
 *
 * Proves that the *application* — not just the schema — works against the data
 * on a given Neon branch. Used by the PITR drill (`scripts/pitr-drill.sh`) to
 * satisfy the "application verification" clause of task 1.9, and reusable for
 * any future branch (restored, adoption, preview) that needs the same proof.
 *
 * WHY THIS EXISTS RATHER THAN CURLING `/health?deep=true`:
 * the Worker's deep health check does not currently execute a database query.
 * `workers/src/health.ts` reports `database: { status: 'pass' }` whenever
 * `NEON_CONNECTION_STRING` is a non-empty string — it never connects. A 200
 * from `/health?deep=true` therefore proves nothing about the restored data.
 * (Making that check run a real readiness query is task 1.10.) This script
 * closes the gap by running the Worker's real queries through the Worker's
 * real driver against an arbitrary connection string.
 *
 * It generalises the ad-hoc compatibility proof recorded for task 1.6.B in
 * `docs/evidence/2026-08-05-1.6b/step4-old-worker-smoke.txt`.
 *
 * READ-ONLY AND TENANT-SAFE. Every statement is a SELECT. The
 * `/api/subscription/current` probe binds a sentinel organization id that
 * cannot match a real row, so running this against a branch restored from
 * production reads no customer data — it proves the columns RESOLVE, which is
 * the compatibility property that matters. The only rows actually read are
 * from `tier_feature_flags` (seeded reference data, not tenant data) and
 * `schema_migrations` (the migration ledger).
 *
 * Usage:
 *   node scripts/verify-app-against-branch.js --url "postgres://..."
 *   VERIFY_DATABASE_URL="postgres://..." node scripts/verify-app-against-branch.js
 *
 * Environment variables:
 *   VERIFY_DATABASE_URL — connection string to verify (or pass --url)
 *   VERIFY_LABEL        — free-text label recorded in the evidence output
 *
 * Exit codes:
 *   0 — every check passed
 *   1 — any check failed, or the connection string is missing/unusable
 *
 * Output: a JSON evidence document on stdout. The connection string is NEVER
 * printed — only its redacted host is recorded.
 */

const path = require('node:path');
const { createRequire } = require('node:module');

/**
 * The Worker's `/api/subscription/current` column list, verbatim from
 * `workers/src/index-minimal.ts` (`handleGetCurrentSubscription`). Keep this in
 * sync with that handler: the whole point of the check is that the columns the
 * live handler selects resolve against the branch under test. `$1` stands in
 * for the authenticated organization id, which the handler binds as a
 * parameter; `subscription_tiers.organization_id` is TEXT
 * (`database/migrations/0000_baseline.up.sql:44`), so a sentinel string binds
 * cleanly and matches nothing.
 */
const SUBSCRIPTION_CURRENT_SQL = `
    SELECT
      status,
      tier_level,
      billing_cycle,
      trial_end_date,
      current_period_end,
      cancel_at_period_end
    FROM subscription_tiers
    WHERE organization_id = $1
    ORDER BY created_at DESC
    LIMIT 1
`;

/**
 * A sentinel organization id. Not a real Clerk/application org id, so the
 * subscription probe returns zero rows against any real database.
 */
const SENTINEL_ORG_ID = '__pitr-drill-nonexistent-org__';

/**
 * Floor for the `public` table count on a healthy restore. The production
 * schema at 0011 carries far more than this; the check exists to catch an
 * empty or half-materialized branch (a restore connected to before its
 * operations reached a terminal state), not to pin an exact count that every
 * future migration would have to update.
 */
const MIN_PUBLIC_TABLES = 20;

const EXPECTED_SUBSCRIPTION_COLUMNS = [
  'status',
  'tier_level',
  'billing_cycle',
  'trial_end_date',
  'current_period_end',
  'cancel_at_period_end',
];

/**
 * Redact a connection string down to a host fingerprint safe to print.
 *
 * Neon endpoint hostnames are treated as production infrastructure identifiers
 * under the repo's redaction convention (see
 * `docs/evidence/2026-08-04-1.7b/README.md`), so only the host's shape is
 * emitted — never the password, user, or full host.
 * @param {string} url
 * @returns {string}
 */
function redactConnectionString(url) {
  if (!url) return '<none>';
  try {
    const parsed = new URL(url);
    const host = parsed.hostname || '';
    const firstLabel = host.split('.')[0] || '';
    const suffix = host.slice(firstLabel.length);
    // Keep only enough of the first label to distinguish endpoints in a log,
    // and drop the rest. e.g. "ep-cool-name-123.eu-central-1.aws.neon.tech"
    // becomes "ep-…(REDACTED)…<suffix>".
    const shape = firstLabel ? `${firstLabel.slice(0, 3)}…REDACTED…` : 'REDACTED';
    return `${shape}${suffix}${parsed.pathname || ''}`;
  } catch {
    return '<unparseable-connection-string>';
  }
}

/**
 * Load the Worker's database driver.
 *
 * `@neondatabase/serverless` is a dependency of `workers/`, not of the repo
 * root, and this repo does not use npm workspaces — so a plain `require` from
 * `scripts/` cannot resolve it. Resolving through `workers/package.json` uses
 * the exact driver the Worker runs with (`workers/src/utils/db-connection.ts`
 * feeds its connection string to this same package), which is the point: the
 * verification must exercise the real client, including its int8-as-string
 * behaviour, not a different Postgres client that happens to be at the root.
 * @param {{ requireFrom?: (id: string) => unknown }} [deps]
 * @returns {{ neon: (url: string) => unknown }}
 */
function loadNeonDriver(deps) {
  const requireFrom =
    deps?.requireFrom || createRequire(path.join(__dirname, '..', 'workers', 'package.json'));
  try {
    return /** @type {{ neon: (url: string) => unknown }} */ (
      requireFrom('@neondatabase/serverless')
    );
  } catch (error) {
    throw new Error(
      '@neondatabase/serverless could not be resolved from workers/. ' +
        'Run `npm ci --prefix workers` and retry. ' +
        `Underlying error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Run every application check against the branch.
 *
 * Takes a `query(sql, params) => Promise<rows>` function rather than a
 * connection string so the checks are unit-testable without a database, in the
 * same dependency-injection style as `scripts/check-neon-pitr.js`.
 *
 * Checks are run sequentially and a failure does not abort the run — every
 * check reports, so a single evidence document shows the full picture rather
 * than only the first problem.
 * @param {(sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>} query
 * @returns {Promise<Array<{ name: string; pass: boolean; detail: string }>>}
 */
async function runChecks(query) {
  /** @type {Array<{ name: string; pass: boolean; detail: string }>} */
  const checks = [];

  /**
   * @param {string} name
   * @param {() => Promise<{ pass: boolean; detail: string }>} fn
   */
  const record = async (name, fn) => {
    try {
      const { pass, detail } = await fn();
      checks.push({ name, pass, detail });
    } catch (error) {
      checks.push({
        name,
        pass: false,
        detail: `threw: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };

  // 1. Readiness. This is the query `/health?deep=true` SHOULD run (task 1.10)
  //    and the minimum proof that the branch accepts connections and serves
  //    reads.
  await record('readiness', async () => {
    const rows = await query('SELECT 1 AS ok');
    const ok = rows.length === 1 && Number(rows[0].ok) === 1;
    return { pass: ok, detail: ok ? 'SELECT 1 returned 1 row' : `unexpected rows: ${rows.length}` };
  });

  // 2. Migration ledger head. Proves the restored branch carries the migration
  //    history (not a pre-adoption or truncated state) and that the newest
  //    entry is settled rather than stuck mid-apply.
  await record('ledger_head', async () => {
    const rows = await query(
      "SELECT id, state FROM schema_migrations WHERE state = 'applied' ORDER BY id DESC LIMIT 1",
    );
    if (rows.length !== 1) {
      return { pass: false, detail: 'no applied migration found in schema_migrations' };
    }
    return { pass: true, detail: `head migration ${String(rows[0].id)} (state=applied)` };
  });

  // 3. No interrupted migrations. An 'applying' row means a previous run died
  //    mid-migration; recovering onto that state would be unsafe.
  await record('ledger_no_interrupted', async () => {
    const rows = await query(
      "SELECT count(*)::int AS n FROM schema_migrations WHERE state <> 'applied'",
    );
    const n = Number(rows[0]?.n ?? -1);
    return {
      pass: n === 0,
      detail: n === 0 ? 'no interrupted rows' : `${n} row(s) not in state 'applied'`,
    };
  });

  // 4. The live /api/subscription/current column list. This is the real
  //    application compatibility surface — if a restore landed on a schema
  //    predating 0011, `current_period_end` / `cancel_at_period_end` would not
  //    resolve and this SELECT would raise "column does not exist".
  //
  //    Executing the real statement is the primary proof (a missing column
  //    throws). The catalog cross-check that follows turns that into a
  //    POSITIVE assertion — "these six columns exist" — rather than relying on
  //    the absence of an exception, so a driver that silently tolerated an
  //    unknown column could not produce a false pass.
  await record('subscription_current_columns', async () => {
    const rows = await query(SUBSCRIPTION_CURRENT_SQL, [SENTINEL_ORG_ID]);
    const catalog = await query(
      'SELECT column_name FROM information_schema.columns ' +
        "WHERE table_schema = 'public' AND table_name = 'subscription_tiers'",
    );
    const present = new Set(catalog.map((r) => String(r.column_name)));
    const missing = EXPECTED_SUBSCRIPTION_COLUMNS.filter((c) => !present.has(c));
    if (missing.length > 0) {
      return { pass: false, detail: `missing column(s): ${missing.join(', ')}` };
    }
    // A sentinel org id that matched a real row would mean the probe is
    // reading tenant data — fail rather than quietly report it as expected.
    if (rows.length !== 0) {
      return {
        pass: false,
        detail: `sentinel organization id unexpectedly matched ${rows.length} row(s)`,
      };
    }
    return {
      pass: true,
      detail:
        `all ${EXPECTED_SUBSCRIPTION_COLUMNS.length} columns resolved and present in catalog ` +
        `(${EXPECTED_SUBSCRIPTION_COLUMNS.join(', ')}); sentinel org matched 0 rows as expected`,
    };
  });

  // 5. Restored-state fidelity: the branch carries a populated public schema.
  //    This is the runbook's `psql -c "SELECT count(*) FROM
  //    information_schema.tables"` step, run through the driver instead. Doing
  //    it here rather than in the shell removes psql from the drill entirely —
  //    under Git Bash, psql is winpty-wrapped and command substitution yields
  //    an empty string with "stdout is not a tty" (see
  //    docs/evidence/2026-08-05-1.6b/step3-restore-drill.txt).
  await record('public_table_count', async () => {
    const rows = await query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const n = Number(rows[0]?.n ?? 0);
    return {
      pass: n >= MIN_PUBLIC_TABLES,
      detail:
        n >= MIN_PUBLIC_TABLES
          ? `${n} tables in public schema`
          : `only ${n} table(s) in public schema (expected >= ${MIN_PUBLIC_TABLES}) — restore may be incomplete`,
    };
  });

  // 6. int8 read compatibility for the 0010 widening. Reference data only.
  //    Documents that the driver reads the widened column without error and
  //    surfaces it as a JS string (the serverless driver's int8 behaviour).
  await record('tier_feature_flags_int8', async () => {
    const rows = await query(
      'SELECT tier_level, feature_key, limit_value FROM tier_feature_flags ' +
        'WHERE limit_value > 2147483647 ORDER BY tier_level LIMIT 5',
    );
    const types = [...new Set(rows.map((r) => typeof r.limit_value))];
    return {
      pass: true,
      detail:
        `${rows.length} oversized (>int4) row(s) read without error` +
        (types.length ? `; js typeof: ${types.join(',')}` : ''),
    };
  });

  return checks;
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {{
 *   argv?: string[];
 *   query?: (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>;
 *   loadDriver?: typeof loadNeonDriver;
 *   now?: () => Date;
 *   stdout?: { write: (s: string) => unknown };
 *   stderr?: { write: (s: string) => unknown };
 * }} [deps]
 * @returns {Promise<number>}
 */
async function main(env, deps) {
  const argv = deps?.argv || process.argv.slice(2);
  const stdout = deps?.stdout || process.stdout;
  const stderr = deps?.stderr || process.stderr;
  const now = deps?.now || (() => new Date());

  const urlFlagIndex = argv.indexOf('--url');
  const url = (urlFlagIndex >= 0 ? argv[urlFlagIndex + 1] : undefined) || env.VERIFY_DATABASE_URL;
  if (!url) {
    stderr.write('::error::Pass --url <connection-string> or set VERIFY_DATABASE_URL.\n');
    return 1;
  }

  let query = deps?.query;
  if (!query) {
    const { neon } = (deps?.loadDriver || loadNeonDriver)();
    const sql =
      /** @type {(s: string, p?: unknown[]) => Promise<Array<Record<string, unknown>>>} */ (
        /** @type {unknown} */ (neon(url))
      );
    // The serverless driver's tagged-template client also accepts
    // (queryString, params) when called as a plain function, which is what the
    // checks need in order to pass a parameterized statement.
    query = (text, params) => sql(text, params || []);
  }

  const startedAt = now();
  const checks = await runChecks(query);
  const finishedAt = now();
  const pass = checks.every((c) => c.pass);

  const evidence = {
    checkedAt: startedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    label: env.VERIFY_LABEL || null,
    target: redactConnectionString(url),
    driver: '@neondatabase/serverless (the driver the Worker runs)',
    checks,
    pass,
  };
  stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);

  if (!pass) {
    const failed = checks.filter((c) => !c.pass).map((c) => c.name);
    stderr.write(`::error::Application verification FAILED: ${failed.join(', ')}\n`);
    return 1;
  }
  stderr.write(`[OK] Application verification PASSED (${checks.length} checks).\n`);
  return 0;
}

module.exports = {
  runChecks,
  redactConnectionString,
  loadNeonDriver,
  main,
  SUBSCRIPTION_CURRENT_SQL,
  SENTINEL_ORG_ID,
  EXPECTED_SUBSCRIPTION_COLUMNS,
  MIN_PUBLIC_TABLES,
};

if (require.main === module) {
  void main(process.env).then((code) => {
    process.exitCode = code;
  });
}
