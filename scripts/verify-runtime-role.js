#!/usr/bin/env node
/**
 * Phase 1.7 prerequisite — runtime-role privilege verification.
 *
 * Verifies that the restricted `app_runtime` role (the Worker's runtime
 * identity) has exactly the privileges it needs and nothing more.
 *
 * Two verification modes:
 *
 *   - **Read-only mode (default, for main):** runs only catalog-level
 *     privilege queries (`has_table_privilege`, `has_sequence_privilege`,
 *     `has_function_privilege`, `pg_has_role`, `pg_class`/`pg_roles`
 *     ownership lookups). No INSERT/UPDATE/DELETE, no nextval, no ALTER
 *     attempt. This is safe to run against production at any time.
 *
 *   - **Active-probe mode (`RUNTIME_ROLE_ACTIVE_PROBE=1`, for the
 *     temporary `migration-role-check` branch):** additionally runs two
 *     rolled-back active probes — a transactional INSERT/UPDATE/DELETE
 *     that proves the grants actually let the Worker write, and an
 *     ALTER TABLE attempt that proves the role cannot alter (expecting
 *     SQLSTATE 42501, failing on any other outcome). Active probes use
 *     a reserved negative ID (`id = -1`) so no serial sequence is
 *     advanced — the probe is non-mutating outside its rolled-back
 *     transaction.
 *
 * Checks performed (all modes unless noted):
 *
 *   - the connected role matches `RUNTIME_ROLE_NAME` (default app_runtime);
 *   - it is NOT a member of `neon_superuser` (Neon's "Add Role" button
 *     grants this automatically — creating the role via SQL `CREATE ROLE`
 *     avoids this inheritance);
 *   - it CANNOT create tables (no CREATE on the public schema);
 *   - it does NOT own any public table and is NOT a member of any
 *     table's owner role (catalog proof — PostgreSQL grants ALTER only
 *     to the owner or a member of the owner role; there is no grantable
 *     ALTER privilege, so non-ownership IS non-alterability);
 *   - [active only] it CANNOT alter an existing table (a real
 *     `ALTER TABLE ... SET (autovacuum_enabled = true)` in a rolled-back
 *     transaction must fail with SQLSTATE 42501; success or any other
 *     SQLSTATE is a failure);
 *   - it CAN SELECT/INSERT/UPDATE/DELETE on every public base table
 *     EXCEPT `schema_migrations` (the migration ledger is owned by the
 *     migration identity, not the runtime role);
 *   - it has NO privileges on `schema_migrations` (SELECT, INSERT,
 *     UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER — all must be
 *     denied; if the ledger does not exist yet, the check passes
 *     vacuously);
 *   - it CAN use sequences (USAGE/SELECT on every public sequence —
 *     catalog only, no nextval);
 *   - it CAN execute every function in public;
 *   - [active only] it CAN actually write (transactional
 *     INSERT/UPDATE/DELETE against `tier_feature_flags` with an explicit
 *     `id = -1` so no sequence is advanced, then ROLLBACK).
 *
 * The `nextval` probe was removed: `nextval` is non-transactional and
 * permanently advances the sequence, which is an unacceptable mutation
 * against production. The catalog-level `has_sequence_privilege` check
 * is the read-only gate; the active write probe (which uses an explicit
 * negative ID and so does not touch the sequence) is the supplementary
 * proof on the temporary branch.
 *
 * Usage:
 *   node scripts/verify-runtime-role.js                      # read-only (main)
 *   RUNTIME_ROLE_ACTIVE_PROBE=1 node scripts/verify-runtime-role.js  # active (branch)
 *
 * Environment variables:
 *   RUNTIME_ROLE_URL         — PostgreSQL connection string authenticated as
 *                              app_runtime (required). The password is never
 *                              printed; output contains only host + database.
 *   RUNTIME_ROLE_NAME        — expected role name (default: app_runtime). The
 *                              script asserts current_user matches this.
 *   RUNTIME_ROLE_ACTIVE_PROBE — when set to a truthy value (1, true, yes),
 *                              runs the active write + alter-denial probes.
 *                              Intended only for the temporary
 *                              migration-role-check branch. Default: unset
 *                              (read-only mode, safe for main).
 *
 * Exit codes:
 *   0 — all privilege checks passed
 *   1 — one or more checks failed, or a connection/setup error occurred
 *
 * Output: a JSON evidence document on stdout suitable for CI artifact
 * upload. Connection strings and passwords are redacted, including in
 * nested probe error messages.
 */

const { Client } = require('pg');

const DEFAULT_ROLE_NAME = 'app_runtime';

/**
 * The migration ledger table. The runtime role must have NO privileges
 * on it — only the migration identity (neondb_owner) accesses it.
 */
const LEDGER_TABLE = 'schema_migrations';

/**
 * The reserved negative ID used by the active write probe. Negative
 * IDs are safe (the serial sequence starts at 1; the integer column
 * accepts negatives) and ensure the INSERT does not call nextval, so
 * no sequence is advanced even if the rollback is imperfect.
 */
const PROBE_RESERVED_ID = -1;

/**
 * Parse a connection string into a redacted { host, database } identity.
 * The password is never included in the output. Mirrors the redaction
 * pattern used by the migration runner (runner.ts redactErrorMessage).
 *
 * @param {string} connectionString
 * @returns {{ host: string, database: string }}
 */
function parseTargetIdentity(connectionString) {
  const url = new URL(connectionString);
  const host = url.hostname.toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  return { host, database };
}

/**
 * Redact passwords / connection strings from an error message string.
 * Handles both `postgresql://user:pass@host` and `password=pass` forms.
 * Used for nested probe errors that might surface a connection string.
 *
 * @param {string} msg
 * @returns {string}
 */
function redactErrorMessage(msg) {
  return String(msg)
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgresql://[redacted]@')
    .replace(/password=[^\s]+/gi, 'password=[redacted]');
}

/**
 * Interpret a truthy env value. Accepts 1/true/yes/on (case-insensitive);
 * everything else (including unset) is false.
 *
 * @param {string | undefined} val
 * @returns {boolean}
 */
function isTruthyEnv(val) {
  if (!val) return false;
  return /^(1|true|yes|on)$/i.test(val.trim());
}

/**
 * Quote a SQL identifier for safe interpolation. Handles mixed-case,
 * spaces, and special characters by wrapping in double quotes and
 * doubling any embedded double quotes.
 *
 * @param {string} ident
 * @returns {string}
 */
function quoteIdent(ident) {
  return '"' + ident.replace(/"/g, '""') + '"';
}

/**
 * Query the catalog for all base tables in the public schema (excluding
 * the migration ledger, which the runtime role must not touch) and
 * verify app_runtime has SELECT, INSERT, UPDATE, DELETE on each.
 *
 * @param {import('pg').Client} client
 * @param {string} role
 * @returns {Promise<{ ok: boolean, missing: string[], checked: number }>}
 */
async function checkTablePrivileges(client, role) {
  const tables = await client.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name <> $1
      ORDER BY table_name`,
    [LEDGER_TABLE],
  );
  const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
  const missing = [];
  for (const row of tables.rows) {
    const table = /** @type {{ table_name: string }} */ (row).table_name;
    for (const priv of privileges) {
      const result = await client.query(
        `SELECT has_table_privilege($1, 'public.' || quote_ident($2), $3) AS ok`,
        [role, table, priv],
      );
      const ok = (result.rows[0] ?? /** @type {any} */ ({})).ok === true;
      if (!ok) missing.push(`${table}:${priv}`);
    }
  }
  return { ok: missing.length === 0, missing, checked: tables.rows.length };
}

/**
 * Verify app_runtime has NO privileges on the migration ledger
 * (`schema_migrations`). The ledger is owned by the migration identity
 * (neondb_owner); the runtime role must not be able to read or write it.
 *
 * If the ledger does not exist yet (e.g., a fresh branch before any
 * migration has run), the check passes vacuously and records
 * `ledgerExists: false`.
 *
 * **Ledger existence is probed via `pg_catalog` (`pg_class` joined to
 * `pg_namespace`), NOT `information_schema.tables`.** This is a
 * deliberate safety choice: `information_schema.tables` only lists
 * tables the current role has some privilege on, so once
 * `REVOKE ALL PRIVILEGES ON TABLE schema_migrations FROM app_runtime`
 * has been applied, `information_schema.tables` HIDES the ledger and a
 * naive existence check would report `ledgerExists: false` — passing
 * vacuously without ever verifying that all seven privileges are
 * denied. This is exactly the false negative observed during the real
 * Neon `migration-role-check` branch exercise: `runtime-role-evidence.json`
 * reported `ledgerExists: false` while a direct `pg_class`/`has_table_privilege`
 * probe (`runtime-ledger-privileges-role-check.txt`) proved `ledger_exists=t`
 * with all seven privileges denied. `pg_class` is a system catalog visible
 * to every role regardless of table privileges, so an existing-but-
 * inaccessible ledger is always detected, and the seven-privilege denial
 * check is then actually exercised.
 *
 * @param {import('pg').Client} client
 * @param {string} role
 * @returns {Promise<{ ok: boolean, ledgerExists: boolean, grantedPrivileges: string[] }>}
 */
async function checkCannotAccessLedger(client, role) {
  const exists = await client.query(
    `SELECT 1
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = $1
        AND c.relkind = 'r'
      LIMIT 1`,
    [LEDGER_TABLE],
  );
  if (exists.rows.length === 0) {
    return { ok: true, ledgerExists: false, grantedPrivileges: [] };
  }
  // Check every table privilege PostgreSQL supports. The runtime role
  // must hold NONE of these on the ledger.
  const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  const granted = [];
  for (const priv of privileges) {
    const result = await client.query(
      `SELECT has_table_privilege($1, 'public.' || quote_ident($2), $3) AS ok`,
      [role, LEDGER_TABLE, priv],
    );
    const ok = (result.rows[0] ?? /** @type {any} */ ({})).ok === true;
    if (ok) granted.push(priv);
  }
  return {
    ok: granted.length === 0,
    ledgerExists: true,
    grantedPrivileges: granted,
  };
}

/**
 * Verify app_runtime has USAGE and SELECT on every sequence in public.
 * Catalog only — no nextval (nextval is non-transactional and would
 * permanently advance the sequence).
 *
 * @param {import('pg').Client} client
 * @param {string} role
 * @returns {Promise<{ ok: boolean, missing: string[], checked: number }>}
 */
async function checkSequencePrivileges(client, role) {
  const sequences = await client.query(
    `SELECT sequence_name
       FROM information_schema.sequences
      WHERE sequence_schema = 'public'
      ORDER BY sequence_name`,
  );
  const privileges = ['USAGE', 'SELECT'];
  const missing = [];
  for (const row of sequences.rows) {
    const seq = /** @type {{ sequence_name: string }} */ (row).sequence_name;
    for (const priv of privileges) {
      const result = await client.query(
        `SELECT has_sequence_privilege($1, 'public.' || quote_ident($2), $3) AS ok`,
        [role, seq, priv],
      );
      const ok = (result.rows[0] ?? /** @type {any} */ ({})).ok === true;
      if (!ok) missing.push(`${seq}:${priv}`);
    }
  }
  return { ok: missing.length === 0, missing, checked: sequences.rows.length };
}

/**
 * Verify app_runtime has EXECUTE on every function in public.
 *
 * @param {import('pg').Client} client
 * @param {string} role
 * @returns {Promise<{ ok: boolean, missing: string[], checked: number }>}
 */
async function checkFunctionPrivileges(client, role) {
  const functions = await client.query(
    `SELECT p.oid::text AS oid, p.proname AS name
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
      ORDER BY p.proname`,
  );
  const missing = [];
  for (const row of functions.rows) {
    const fn = /** @type {{ oid: string, name: string }} */ (row);
    const result = await client.query(
      `SELECT has_function_privilege($1, $2::oid, 'EXECUTE') AS ok`,
      [role, fn.oid],
    );
    const ok = (result.rows[0] ?? /** @type {any} */ ({})).ok === true;
    if (!ok) missing.push(`${fn.name}(${fn.oid})`);
  }
  return { ok: missing.length === 0, missing, checked: functions.rows.length };
}

/**
 * Verify app_runtime is NOT a member of neon_superuser. Neon's "Add Role"
 * button grants this automatically; a SQL-created role should not have it.
 *
 * @param {import('pg').Client} client
 * @param {string} role
 * @returns {Promise<{ ok: boolean, isMember: boolean }>}
 */
async function checkNotSuperuser(client, role) {
  const result = await client.query(
    `SELECT pg_has_role($1, 'neon_superuser', 'member') AS is_member`,
    [role],
  );
  const isMember = (result.rows[0] ?? /** @type {any} */ ({})).is_member === true;
  return { ok: !isMember, isMember };
}

/**
 * Verify app_runtime CANNOT create tables (no CREATE on schema).
 *
 * @param {import('pg').Client} client
 * @param {string} role
 * @returns {Promise<{ ok: boolean, canCreate: boolean }>}
 */
async function checkCannotCreateTables(client, role) {
  const result = await client.query(
    `SELECT has_schema_privilege($1, 'public', 'CREATE') AS can_create`,
    [role],
  );
  const canCreate = (result.rows[0] ?? /** @type {any} */ ({})).can_create === true;
  return { ok: !canCreate, canCreate };
}

/**
 * Catalog-based proof that app_runtime does NOT own any public table and
 * is NOT a member of any table's owner role. PostgreSQL grants ALTER
 * only to the table owner (or a member of the owner role) — there is no
 * grantable ALTER privilege — so non-ownership/non-membership IS
 * non-alterability. This is the primary cannot-alter proof; the active
 * probe (`checkCannotAlterTablesActive`) is supplementary.
 *
 * @param {import('pg').Client} client
 * @param {string} role
 * @returns {Promise<{ ok: boolean, violations: Array<{ table: string, owner: string, isMember: boolean }>, checked: number }>}
 */
async function checkTableOwnership(client, role) {
  const tables = await client.query(
    `SELECT c.relname AS table_name,
            r.rolname AS owner
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname <> $1
      ORDER BY c.relname`,
    [LEDGER_TABLE],
  );
  const violations = [];
  for (const row of tables.rows) {
    const t = /** @type {{ table_name: string, owner: string }} */ (row);
    const isOwner = t.owner === role;
    let isMember = false;
    if (!isOwner) {
      const memberResult = await client.query(`SELECT pg_has_role($1, $2, 'member') AS is_member`, [
        role,
        t.owner,
      ]);
      isMember = (memberResult.rows[0] ?? /** @type {any} */ ({})).is_member === true;
    }
    if (isOwner || isMember) {
      violations.push({ table: t.table_name, owner: t.owner, isMember });
    }
  }
  return {
    ok: violations.length === 0,
    violations,
    checked: tables.rows.length,
  };
}

/**
 * Active probe (run only in active mode): prove app_runtime CANNOT alter
 * an existing table by attempting a valid owner-only ALTER in a
 * rolled-back transaction. The statement `ALTER TABLE ... SET
 * (autovacuum_enabled = true)` requires ownership; a non-owner must
 * receive SQLSTATE 42501 (insufficient_privilege).
 *
 * Outcomes:
 *   - ALTER succeeds → role can alter → FAIL
 *   - ALTER fails with SQLSTATE 42501 → expected denial → PASS
 *   - ALTER fails with any other SQLSTATE → unexpected error → FAIL
 *     (this catches the old bug where an undefined-column error (42703)
 *     was misread as "permission denied" and produced a false success)
 *
 * @param {import('pg').Client} client
 * @returns {Promise<{ ok: boolean, table: string | null, alterSucceeded: boolean, sqlstate: string | null, error: string | null }>}
 */
async function checkCannotAlterTablesActive(client) {
  const tables = await client.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name <> $1
      ORDER BY table_name LIMIT 1`,
    [LEDGER_TABLE],
  );
  if (tables.rows.length === 0) {
    return {
      ok: true,
      table: null,
      alterSucceeded: false,
      sqlstate: null,
      error: null,
    };
  }
  const table = /** @type {{ table_name: string }} */ (tables.rows[0]).table_name;
  let alterSucceeded = false;
  let sqlstate = null;
  let errorMsg = null;
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.${quoteIdent(table)} SET (autovacuum_enabled = true)`);
    alterSucceeded = true;
  } catch (error) {
    sqlstate = /** @type {{ code?: string }} */ (error)?.code ?? null;
    errorMsg = error instanceof Error ? error.message : String(error);
  } finally {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Best-effort.
    }
  }
  // PASS only if the ALTER failed with the expected permission-denied
  // SQLSTATE. Success → fail. Any other SQLSTATE → fail (unexpected).
  const ok = !alterSucceeded && sqlstate === '42501';
  return {
    ok,
    table,
    alterSucceeded,
    sqlstate,
    error: ok ? null : redactErrorMessage(errorMsg ?? ''),
  };
}

/**
 * Active probe (run only in active mode): prove app_runtime can actually
 * write by doing a transactional INSERT/UPDATE/DELETE against
 * `tier_feature_flags`, then rolling back. Uses an explicit reserved
 * negative ID (`id = -1`) so the serial sequence is NOT advanced — the
 * probe is non-mutating outside its rolled-back transaction. The
 * `ON CONFLICT DO NOTHING` makes the INSERT idempotent even if the
 * rollback somehow fails.
 *
 * @param {import('pg').Client} client
 * @returns {Promise<{ ok: boolean, error: string | null }>}
 */
async function checkCanWrite(client) {
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO tier_feature_flags (id, tier_level, feature_key, enabled, limit_value)
       VALUES ($1, '_runtime_role_probe', '_runtime_role_probe', false, 0)
       ON CONFLICT (tier_level, feature_key) DO NOTHING`,
      [PROBE_RESERVED_ID],
    );
    await client.query(
      `UPDATE tier_feature_flags
          SET enabled = false
        WHERE id = $1`,
      [PROBE_RESERVED_ID],
    );
    await client.query(`DELETE FROM tier_feature_flags WHERE id = $1`, [PROBE_RESERVED_ID]);
    await client.query('ROLLBACK');
    return { ok: true, error: null };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Best-effort.
    }
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: redactErrorMessage(msg) };
  }
}

/**
 * Run all privilege checks against the connected client.
 *
 * @param {import('pg').Client} client
 * @param {string} expectedRole
 * @param {boolean} activeProbe — when true, run the active write + alter
 *        probes (intended for the temporary migration-role-check branch
 *        only). When false, run only read-only catalog checks (safe for
 *        main).
 * @returns {Promise<object>}
 */
async function runAllChecks(client, expectedRole, activeProbe = false) {
  // Confirm the connected role matches the expected runtime role.
  const roleResult = await client.query('SELECT current_user AS role');
  const connectedRole = (roleResult.rows[0] ?? /** @type {any} */ ({})).role ?? null;
  const roleMatches = connectedRole === expectedRole;

  const notSuperuser = await checkNotSuperuser(client, expectedRole);
  const cannotCreate = await checkCannotCreateTables(client, expectedRole);
  const ownership = await checkTableOwnership(client, expectedRole);
  const tables = await checkTablePrivileges(client, expectedRole);
  const ledger = await checkCannotAccessLedger(client, expectedRole);
  const sequences = await checkSequencePrivileges(client, expectedRole);
  const functions = await checkFunctionPrivileges(client, expectedRole);

  const checks = {
    roleMatches: { ok: roleMatches, connected: connectedRole, expected: expectedRole },
    notSuperuserMember: notSuperuser,
    cannotCreateTables: cannotCreate,
    tableOwnership: ownership,
    tablePrivileges: tables,
    ledgerAccessDenied: ledger,
    sequencePrivileges: sequences,
    functionPrivileges: functions,
    activeProbe: { enabled: activeProbe },
  };

  let allOk =
    roleMatches &&
    notSuperuser.ok &&
    cannotCreate.ok &&
    ownership.ok &&
    tables.ok &&
    ledger.ok &&
    sequences.ok &&
    functions.ok;

  if (activeProbe) {
    const write = await checkCanWrite(client);
    const alter = await checkCannotAlterTablesActive(client);
    checks.canWrite = write;
    checks.cannotAlterTables = alter;
    allOk = allOk && write.ok && alter.ok;
  }

  return { ok: allOk, checks };
}

/**
 * Build a human-readable report from the check results.
 *
 * @param {object} results
 * @param {{ host: string, database: string }} target
 * @returns {string}
 */
function formatReport(results, target) {
  const lines = [];
  lines.push(`Runtime role verification — ${target.host}/${target.database}`);
  lines.push(`Overall: ${results.ok ? 'PASS' : 'FAIL'}`);
  lines.push(`Mode: ${results.checks.activeProbe.enabled ? 'active-probe' : 'read-only'}`);
  lines.push('');
  const c = results.checks;
  lines.push(
    `roleMatches: ${c.roleMatches.ok ? 'PASS' : 'FAIL'} (connected=${c.roleMatches.connected}, expected=${c.roleMatches.expected})`,
  );
  lines.push(
    `notSuperuserMember: ${c.notSuperuserMember.ok ? 'PASS' : 'FAIL'} (isMember=${c.notSuperuserMember.isMember})`,
  );
  lines.push(
    `cannotCreateTables: ${c.cannotCreateTables.ok ? 'PASS' : 'FAIL'} (canCreate=${c.cannotCreateTables.canCreate})`,
  );
  lines.push(
    `tableOwnership: ${c.tableOwnership.ok ? 'PASS' : 'FAIL'} (checked=${c.tableOwnership.checked}, violations=${c.tableOwnership.violations.map((v) => `${v.table}(owner=${v.owner})`).join(',') || 'none'})`,
  );
  lines.push(
    `tablePrivileges: ${c.tablePrivileges.ok ? 'PASS' : 'FAIL'} (checked=${c.tablePrivileges.checked}, missing=${c.tablePrivileges.missing.join(',') || 'none'})`,
  );
  lines.push(
    `ledgerAccessDenied: ${c.ledgerAccessDenied.ok ? 'PASS' : 'FAIL'} (ledgerExists=${c.ledgerAccessDenied.ledgerExists}, granted=${c.ledgerAccessDenied.grantedPrivileges.join(',') || 'none'})`,
  );
  lines.push(
    `sequencePrivileges: ${c.sequencePrivileges.ok ? 'PASS' : 'FAIL'} (checked=${c.sequencePrivileges.checked}, missing=${c.sequencePrivileges.missing.join(',') || 'none'})`,
  );
  lines.push(
    `functionPrivileges: ${c.functionPrivileges.ok ? 'PASS' : 'FAIL'} (checked=${c.functionPrivileges.checked}, missing=${c.functionPrivileges.missing.join(',') || 'none'})`,
  );
  if (c.canWrite) {
    lines.push(
      `canWrite: ${c.canWrite.ok ? 'PASS' : 'FAIL'}${c.canWrite.error ? ` (error=${c.canWrite.error})` : ''}`,
    );
  }
  if (c.cannotAlterTables) {
    lines.push(
      `cannotAlterTables: ${c.cannotAlterTables.ok ? 'PASS' : 'FAIL'} (table=${c.cannotAlterTables.table}, alterSucceeded=${c.cannotAlterTables.alterSucceeded}, sqlstate=${c.cannotAlterTables.sqlstate}${c.cannotAlterTables.error ? `, error=${c.cannotAlterTables.error}` : ''})`,
    );
  }
  return lines.join('\n');
}

/**
 * Main entry point. Connects to the database, runs all checks, prints
 * JSON evidence on stdout, exits non-zero on failure.
 *
 * @param {Record<string, string | undefined>} env
 * @param {object} [options]
 * @param {typeof Client} [options.ClientCtor]
 * @param {(output: string) => void} [options.log]
 * @returns {Promise<number>}
 */
async function main(env, options = {}) {
  const ClientCtor = options.ClientCtor ?? Client;
  const log = options.log ?? ((msg) => process.stdout.write(msg));

  const url = env.RUNTIME_ROLE_URL;
  if (!url) {
    const evidence = {
      ok: false,
      error: 'RUNTIME_ROLE_URL is required (the app_runtime connection string)',
    };
    log(JSON.stringify(evidence, null, 2) + '\n');
    return 1;
  }

  const expectedRole = env.RUNTIME_ROLE_NAME ?? DEFAULT_ROLE_NAME;
  const activeProbe = isTruthyEnv(env.RUNTIME_ROLE_ACTIVE_PROBE);
  let target;
  try {
    target = parseTargetIdentity(url);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const evidence = { ok: false, error: `Invalid RUNTIME_ROLE_URL: ${msg}` };
    log(JSON.stringify(evidence, null, 2) + '\n');
    return 1;
  }

  const client = new ClientCtor({
    connectionString: url,
    // Keep statement timeouts bounded so a hung connection cannot stall.
    statement_timeout: 30000,
    connectionTimeoutMillis: 10000,
  });

  let results;
  try {
    await client.connect();
    results = await runAllChecks(client, expectedRole, activeProbe);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const evidence = {
      ok: false,
      target: { host: target.host, database: target.database },
      error: redactErrorMessage(msg),
    };
    log(JSON.stringify(evidence, null, 2) + '\n');
    return 1;
  } finally {
    try {
      await client.end();
    } catch {
      // Best-effort.
    }
  }

  const evidence = {
    ok: results.ok,
    target: { host: target.host, database: target.database },
    role: expectedRole,
    mode: activeProbe ? 'active-probe' : 'read-only',
    checks: results.checks,
    report: formatReport(results, target),
  };
  log(JSON.stringify(evidence, null, 2) + '\n');
  return results.ok ? 0 : 1;
}

module.exports = {
  parseTargetIdentity,
  redactErrorMessage,
  isTruthyEnv,
  quoteIdent,
  checkNotSuperuser,
  checkCannotCreateTables,
  checkTableOwnership,
  checkCannotAlterTablesActive,
  checkTablePrivileges,
  checkCannotAccessLedger,
  checkSequencePrivileges,
  checkFunctionPrivileges,
  checkCanWrite,
  runAllChecks,
  formatReport,
  main,
  DEFAULT_ROLE_NAME,
  LEDGER_TABLE,
  PROBE_RESERVED_ID,
};

// Run main() only when invoked directly, not when required by tests.
if (require.main === module) {
  void main(process.env).then((code) => {
    process.exitCode = code;
  });
}
