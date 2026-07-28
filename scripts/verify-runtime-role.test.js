const test = require('node:test');
const assert = require('node:assert/strict');

const {
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
} = require('./verify-runtime-role.js');

/**
 * Build a mock pg Client whose query() returns scripted responses.
 *
 * The `script` is either:
 *   - a function (text, params) => { rows, rowCount? } | Error  — full control
 *   - an array of { match: RegExp, rows: object[] | (() => object[]) } — sequential
 *
 * BEGIN/COMMIT/ROLLBACK are always treated as no-ops (return { rows: [] }).
 *
 * @param {object} script
 * @returns {object} a fake Client with connect/end/query
 */
function makeClient(script) {
  const calls = [];
  const handler =
    typeof script === 'function'
      ? script
      : (text) => {
          for (const entry of script) {
            if (entry.match.test(text)) {
              const rows = typeof entry.rows === 'function' ? entry.rows() : entry.rows;
              return { rows: rows ?? [], rowCount: rows?.length ?? 0 };
            }
          }
          // Default: queries not explicitly scripted return empty rows.
          // BEGIN/COMMIT/ROLLBACK are no-ops.
          if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(text.trim())) {
            return { rows: [], rowCount: 0 };
          }
          throw new Error(`unexpected query: ${text.slice(0, 80)}`);
        };

  const client = {
    connected: false,
    ended: false,
    async connect() {
      this.connected = true;
    },
    async end() {
      this.ended = true;
    },
    async query(text, params) {
      calls.push({ text, params });
      const result = handler(text, params);
      if (result instanceof Error) throw result;
      return result;
    },
    calls,
  };
  return client;
}

/**
 * Build a mock Client constructor that returns the given client instance.
 *
 * @param {object} client
 * @returns {typeof import('pg').Client}
 */
function makeClientCtor(client) {
  function FakeClient(config) {
    FakeClient.lastConfig = config;
    return client;
  }
  FakeClient.lastConfig = null;
  return FakeClient;
}

/**
 * A pg-shaped error with a SQLSTATE code. The real `pg` library surfaces
 * the SQLSTATE on `error.code`.
 */
function pgError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// parseTargetIdentity
// ---------------------------------------------------------------------------

test('parseTargetIdentity extracts host and database, omits password', () => {
  const id = parseTargetIdentity('postgresql://app_runtime:secret@ep-host.neon.tech/neondb');
  assert.equal(id.host, 'ep-host.neon.tech');
  assert.equal(id.database, 'neondb');
});

test('parseTargetIdentity lowercases the host', () => {
  const id = parseTargetIdentity('postgresql://u:p@EP-HOST.NEON.TECH/neondb');
  assert.equal(id.host, 'ep-host.neon.tech');
});

test('parseTargetIdentity decodes a percent-encoded database name', () => {
  const id = parseTargetIdentity('postgresql://u:p@h.test/my%20db');
  assert.equal(id.database, 'my db');
});

// ---------------------------------------------------------------------------
// redactErrorMessage
// ---------------------------------------------------------------------------

test('redactErrorMessage redacts a postgresql:// connection string', () => {
  const out = redactErrorMessage('connect failed: postgresql://app_runtime:leakedpw@host/db');
  assert.doesNotMatch(out, /leakedpw/);
  assert.match(out, /\[redacted\]/);
});

test('redactErrorMessage redacts a password= form', () => {
  const out = redactErrorMessage('authentication failed password=hunter2 for user app_runtime');
  assert.doesNotMatch(out, /hunter2/);
  assert.match(out, /password=\[redacted\]/);
});

test('redactErrorMessage passes through a message with no secrets', () => {
  const out = redactErrorMessage('permission denied for table organizations');
  assert.equal(out, 'permission denied for table organizations');
});

// ---------------------------------------------------------------------------
// isTruthyEnv
// ---------------------------------------------------------------------------

test('isTruthyEnv accepts 1/true/yes/on case-insensitively', () => {
  assert.equal(isTruthyEnv('1'), true);
  assert.equal(isTruthyEnv('true'), true);
  assert.equal(isTruthyEnv('TRUE'), true);
  assert.equal(isTruthyEnv('yes'), true);
  assert.equal(isTruthyEnv('On'), true);
});

test('isTruthyEnv rejects unset, empty, and other values', () => {
  assert.equal(isTruthyEnv(undefined), false);
  assert.equal(isTruthyEnv(''), false);
  assert.equal(isTruthyEnv('0'), false);
  assert.equal(isTruthyEnv('false'), false);
  assert.equal(isTruthyEnv('anything-else'), false);
});

// ---------------------------------------------------------------------------
// quoteIdent
// ---------------------------------------------------------------------------

test('quoteIdent wraps a simple identifier in double quotes', () => {
  assert.equal(quoteIdent('organizations'), '"organizations"');
});

test('quoteIdent doubles embedded double quotes (identifier quoting)', () => {
  // A table name containing a double quote must be escaped by doubling.
  assert.equal(quoteIdent('weird"name'), '"weird""name"');
});

test('quoteIdent preserves mixed-case identifiers (regression: identifier quoting)', () => {
  // Mixed-case identifiers MUST be quoted so PostgreSQL does not fold them.
  assert.equal(quoteIdent('MixedCaseTable'), '"MixedCaseTable"');
});

test('quoteIdent handles a name with spaces', () => {
  assert.equal(quoteIdent('has space'), '"has space"');
});

// ---------------------------------------------------------------------------
// checkNotSuperuser
// ---------------------------------------------------------------------------

test('checkNotSuperuser passes when pg_has_role returns false', async () => {
  const client = makeClient([{ match: /pg_has_role/, rows: [{ is_member: false }] }]);
  const r = await checkNotSuperuser(client, 'app_runtime');
  assert.equal(r.ok, true);
  assert.equal(r.isMember, false);
});

test('checkNotSuperuser fails when app_runtime is a neon_superuser member', async () => {
  const client = makeClient([{ match: /pg_has_role/, rows: [{ is_member: true }] }]);
  const r = await checkNotSuperuser(client, 'app_runtime');
  assert.equal(r.ok, false);
  assert.equal(r.isMember, true);
});

// ---------------------------------------------------------------------------
// checkCannotCreateTables
// ---------------------------------------------------------------------------

test('checkCannotCreateTables passes when CREATE is denied', async () => {
  const client = makeClient([{ match: /has_schema_privilege/, rows: [{ can_create: false }] }]);
  const r = await checkCannotCreateTables(client, 'app_runtime');
  assert.equal(r.ok, true);
  assert.equal(r.canCreate, false);
});

test('checkCannotCreateTables fails when CREATE is granted', async () => {
  const client = makeClient([{ match: /has_schema_privilege/, rows: [{ can_create: true }] }]);
  const r = await checkCannotCreateTables(client, 'app_runtime');
  assert.equal(r.ok, false);
  assert.equal(r.canCreate, true);
});

// ---------------------------------------------------------------------------
// checkTableOwnership (catalog-based non-ownership proof)
// ---------------------------------------------------------------------------

test('checkTableOwnership passes when app_runtime owns nothing and is not a member of any owner', async () => {
  const client = makeClient((text) => {
    if (/pg_class/i.test(text) && /relkind/i.test(text)) {
      return {
        rows: [
          { table_name: 'organizations', owner: 'neondb_owner' },
          { table_name: 'users', owner: 'neondb_owner' },
        ],
      };
    }
    if (/pg_has_role/i.test(text)) {
      return { rows: [{ is_member: false }] };
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkTableOwnership(client, 'app_runtime');
  assert.equal(r.ok, true);
  assert.equal(r.checked, 2);
  assert.deepEqual(r.violations, []);
});

test('checkTableOwnership fails when app_runtime directly owns a table', async () => {
  const client = makeClient((text) => {
    if (/pg_class/i.test(text) && /relkind/i.test(text)) {
      return { rows: [{ table_name: 'organizations', owner: 'app_runtime' }] };
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkTableOwnership(client, 'app_runtime');
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].table, 'organizations');
  assert.equal(r.violations[0].owner, 'app_runtime');
});

test('checkTableOwnership fails when app_runtime is a member of the owner role', async () => {
  const client = makeClient((text) => {
    if (/pg_class/i.test(text) && /relkind/i.test(text)) {
      return { rows: [{ table_name: 'organizations', owner: 'neondb_owner' }] };
    }
    if (/pg_has_role/i.test(text)) {
      return { rows: [{ is_member: true }] };
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkTableOwnership(client, 'app_runtime');
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].isMember, true);
});

test('checkTableOwnership excludes the migration ledger from the ownership scan', async () => {
  // The ledger is owned by neondb_owner and must NOT be scanned here
  // (it is checked by checkCannotAccessLedger instead). Verify the
  // pg_class query filters it out via the $1 parameter.
  const client = makeClient((text, params) => {
    if (/pg_class/i.test(text) && /relkind/i.test(text)) {
      // The exclusion is parameterized: c.relname <> $1.
      assert.equal(params?.[0], LEDGER_TABLE);
      return { rows: [] };
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkTableOwnership(client, 'app_runtime');
  assert.equal(r.ok, true);
  assert.equal(r.checked, 0);
});

test('checkTableOwnership passes (vacuously) when public has no non-ledger tables', async () => {
  const client = makeClient((text) => {
    if (/pg_class/i.test(text)) return { rows: [] };
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkTableOwnership(client, 'app_runtime');
  assert.equal(r.ok, true);
  assert.equal(r.checked, 0);
});

// ---------------------------------------------------------------------------
// checkCannotAlterTablesActive (strict SQLSTATE 42501)
// ---------------------------------------------------------------------------

test('checkCannotAlterTablesActive passes when ALTER fails with SQLSTATE 42501', async () => {
  const client = makeClient((text) => {
    if (/information_schema.tables/i.test(text)) {
      return { rows: [{ table_name: 'organizations' }] };
    }
    if (/^BEGIN$/i.test(text.trim())) return { rows: [] };
    if (/^ROLLBACK$/i.test(text.trim())) return { rows: [] };
    if (/ALTER TABLE/i.test(text)) {
      throw pgError('permission denied for table organizations', '42501');
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkCannotAlterTablesActive(client);
  assert.equal(r.ok, true);
  assert.equal(r.table, 'organizations');
  assert.equal(r.alterSucceeded, false);
  assert.equal(r.sqlstate, '42501');
  assert.equal(r.error, null);
});

test('checkCannotAlterTablesActive fails when ALTER succeeds (role can alter)', async () => {
  const client = makeClient((text) => {
    if (/information_schema.tables/i.test(text)) {
      return { rows: [{ table_name: 'organizations' }] };
    }
    if (/^BEGIN$/i.test(text.trim())) return { rows: [] };
    if (/^ROLLBACK$/i.test(text.trim())) return { rows: [] };
    if (/ALTER TABLE/i.test(text)) return { rows: [] };
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkCannotAlterTablesActive(client);
  assert.equal(r.ok, false);
  assert.equal(r.alterSucceeded, true);
});

test('checkCannotAlterTablesActive fails on undefined-column (regression: false success via 42703)', async () => {
  // The OLD probe used ALTER COLUMN dummy_no_such_col, which fails with
  // 42703 (undefined_column) regardless of privileges — a false success.
  // The new probe uses a valid owner-only statement, so a 42703 would be
  // an UNEXPECTED error and must FAIL, not pass.
  const client = makeClient((text) => {
    if (/information_schema.tables/i.test(text)) {
      return { rows: [{ table_name: 'organizations' }] };
    }
    if (/^BEGIN$/i.test(text.trim())) return { rows: [] };
    if (/^ROLLBACK$/i.test(text.trim())) return { rows: [] };
    if (/ALTER TABLE/i.test(text)) {
      throw pgError('column "dummy_no_such_col" does not exist', '42703');
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkCannotAlterTablesActive(client);
  assert.equal(r.ok, false);
  assert.equal(r.alterSucceeded, false);
  assert.equal(r.sqlstate, '42703');
  assert.match(r.error, /dummy_no_such_col/);
});

test('checkCannotAlterTablesActive fails on any unexpected SQLSTATE', async () => {
  const client = makeClient((text) => {
    if (/information_schema.tables/i.test(text)) {
      return { rows: [{ table_name: 'organizations' }] };
    }
    if (/^BEGIN$/i.test(text.trim())) return { rows: [] };
    if (/^ROLLBACK$/i.test(text.trim())) return { rows: [] };
    if (/ALTER TABLE/i.test(text)) {
      throw pgError('lock not available', '55P03');
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkCannotAlterTablesActive(client);
  assert.equal(r.ok, false);
  assert.equal(r.sqlstate, '55P03');
});

test('checkCannotAlterTablesActive passes (vacuously) when public has no non-ledger tables', async () => {
  const client = makeClient([{ match: /information_schema.tables/i, rows: [] }]);
  const r = await checkCannotAlterTablesActive(client);
  assert.equal(r.ok, true);
  assert.equal(r.table, null);
});

test('checkCannotAlterTablesActive uses a valid owner-only statement (autovacuum_enabled reloption)', async () => {
  // The ALTER must use a real owner-only statement, not a nonexistent
  // column. Confirm the SQL text targets autovacuum_enabled.
  const client = makeClient((text) => {
    if (/information_schema.tables/i.test(text)) {
      return { rows: [{ table_name: 'organizations' }] };
    }
    if (/^BEGIN$/i.test(text.trim())) return { rows: [] };
    if (/^ROLLBACK$/i.test(text.trim())) return { rows: [] };
    if (/ALTER TABLE/i.test(text)) {
      assert.match(text, /autovacuum_enabled/i);
      throw pgError('permission denied', '42501');
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkCannotAlterTablesActive(client);
  assert.equal(r.ok, true);
});

test('checkCannotAlterTablesActive redacts a connection string leaked in the error message', async () => {
  // Regression: nested probe errors must be redacted.
  const client = makeClient((text) => {
    if (/information_schema.tables/i.test(text)) {
      return { rows: [{ table_name: 'organizations' }] };
    }
    if (/^BEGIN$/i.test(text.trim())) return { rows: [] };
    if (/^ROLLBACK$/i.test(text.trim())) return { rows: [] };
    if (/ALTER TABLE/i.test(text)) {
      throw pgError(
        'link postgresql://app_runtime:leakedpw@ep-host.neon.tech/neondb failed',
        '42501',
      );
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkCannotAlterTablesActive(client);
  // 42501 is the expected denial, so ok=true and error=null — the
  // redaction path is not exercised on success. To exercise it, use a
  // non-42501 error.
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
});

test('checkCannotAlterTablesActive redacts a connection string in an unexpected error', async () => {
  const client = makeClient((text) => {
    if (/information_schema.tables/i.test(text)) {
      return { rows: [{ table_name: 'organizations' }] };
    }
    if (/^BEGIN$/i.test(text.trim())) return { rows: [] };
    if (/^ROLLBACK$/i.test(text.trim())) return { rows: [] };
    if (/ALTER TABLE/i.test(text)) {
      throw pgError('fatal: postgresql://app_runtime:leakedpw@ep-host.neon.tech/neondb', 'XX000');
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkCannotAlterTablesActive(client);
  assert.equal(r.ok, false);
  assert.equal(r.sqlstate, 'XX000');
  assert.doesNotMatch(r.error, /leakedpw/);
  assert.match(r.error, /\[redacted\]/);
});

// ---------------------------------------------------------------------------
// checkTablePrivileges (excludes schema_migrations)
// ---------------------------------------------------------------------------

test('checkTablePrivileges passes when all 4 privileges are granted on every non-ledger table', async () => {
  const client = makeClient((text) => {
    if (/information_schema.tables/i.test(text)) {
      return { rows: [{ table_name: 'organizations' }, { table_name: 'users' }] };
    }
    if (/has_table_privilege/i.test(text)) {
      return { rows: [{ ok: true }] };
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkTablePrivileges(client, 'app_runtime');
  assert.equal(r.ok, true);
  assert.equal(r.checked, 2);
  assert.deepEqual(r.missing, []);
});

test('checkTablePrivileges fails and lists the missing privilege', async () => {
  const client = makeClient((text, params) => {
    if (/information_schema.tables/i.test(text)) {
      return { rows: [{ table_name: 'organizations' }] };
    }
    if (/has_table_privilege/i.test(text)) {
      const priv = params?.[2];
      return { rows: [{ ok: priv !== 'INSERT' }] };
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkTablePrivileges(client, 'app_runtime');
  assert.equal(r.ok, false);
  assert.equal(r.checked, 1);
  assert.deepEqual(r.missing, ['organizations:INSERT']);
});

test('checkTablePrivileges excludes schema_migrations from the required-DML set (regression: ledger access)', async () => {
  // The ledger must NOT be in the required-DML list. Verify the
  // information_schema query filters it out via the $1 parameter.
  const client = makeClient((text, params) => {
    if (/information_schema.tables/i.test(text)) {
      // The exclusion is parameterized: table_name <> $1.
      assert.equal(params?.[0], LEDGER_TABLE);
      // Return only non-ledger tables.
      return { rows: [{ table_name: 'organizations' }] };
    }
    if (/has_table_privilege/i.test(text)) {
      return { rows: [{ ok: true }] };
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkTablePrivileges(client, 'app_runtime');
  assert.equal(r.ok, true);
  assert.equal(r.checked, 1);
});

test('checkTablePrivileges passes (vacuously) when public has no non-ledger tables', async () => {
  const client = makeClient([{ match: /information_schema.tables/i, rows: [] }]);
  const r = await checkTablePrivileges(client, 'app_runtime');
  assert.equal(r.ok, true);
  assert.equal(r.checked, 0);
});

// ---------------------------------------------------------------------------
// checkCannotAccessLedger (regression: ledger access)
// ---------------------------------------------------------------------------

test('checkCannotAccessLedger passes when the runtime role has NO privileges on the ledger', async () => {
  const client = makeClient((text) => {
    if (/pg_class/i.test(text) && /pg_namespace/i.test(text) && /LIMIT 1/i.test(text)) {
      // ledger exists check (pg_catalog — visible even after REVOKE)
      return { rows: [{ '?column?': 1 }] };
    }
    if (/has_table_privilege/i.test(text)) {
      return { rows: [{ ok: false }] };
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkCannotAccessLedger(client, 'app_runtime');
  assert.equal(r.ok, true);
  assert.equal(r.ledgerExists, true);
  assert.deepEqual(r.grantedPrivileges, []);
});

test('checkCannotAccessLedger fails when the runtime role has SELECT on the ledger', async () => {
  const client = makeClient((text, params) => {
    if (/pg_class/i.test(text) && /pg_namespace/i.test(text) && /LIMIT 1/i.test(text)) {
      // ledger exists check (pg_catalog — visible even after REVOKE)
      return { rows: [{ '?column?': 1 }] };
    }
    if (/has_table_privilege/i.test(text)) {
      const priv = params?.[2];
      return { rows: [{ ok: priv === 'SELECT' }] };
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkCannotAccessLedger(client, 'app_runtime');
  assert.equal(r.ok, false);
  assert.equal(r.ledgerExists, true);
  assert.deepEqual(r.grantedPrivileges, ['SELECT']);
});

test('checkCannotAccessLedger fails when the runtime role has INSERT on the ledger', async () => {
  const client = makeClient((text, params) => {
    if (/pg_class/i.test(text) && /pg_namespace/i.test(text) && /LIMIT 1/i.test(text)) {
      // ledger exists check (pg_catalog — visible even after REVOKE)
      return { rows: [{ '?column?': 1 }] };
    }
    if (/has_table_privilege/i.test(text)) {
      const priv = params?.[2];
      return { rows: [{ ok: priv === 'INSERT' }] };
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkCannotAccessLedger(client, 'app_runtime');
  assert.equal(r.ok, false);
  assert.deepEqual(r.grantedPrivileges, ['INSERT']);
});

test('checkCannotAccessLedger fails listing ALL granted privileges', async () => {
  const client = makeClient((text) => {
    if (/pg_class/i.test(text) && /pg_namespace/i.test(text) && /LIMIT 1/i.test(text)) {
      // ledger exists check (pg_catalog — visible even after REVOKE)
      return { rows: [{ '?column?': 1 }] };
    }
    if (/has_table_privilege/i.test(text)) {
      // Grant every privilege — all should be reported.
      return { rows: [{ ok: true }] };
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkCannotAccessLedger(client, 'app_runtime');
  assert.equal(r.ok, false);
  assert.equal(r.grantedPrivileges.length, 7);
});

test('checkCannotAccessLedger passes vacuously when the ledger does not exist yet', async () => {
  const client = makeClient((text) => {
    if (/pg_class/i.test(text) && /relkind/i.test(text) && /LIMIT 1/i.test(text)) {
      return { rows: [] };
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkCannotAccessLedger(client, 'app_runtime');
  assert.equal(r.ok, true);
  assert.equal(r.ledgerExists, false);
  assert.deepEqual(r.grantedPrivileges, []);
});

test('checkCannotAccessLedger detects an existing-but-inaccessible ledger via pg_catalog (regression: information_schema hides revoked ledger)', async () => {
  // Regression for the real Neon migration-role-check finding: after
  // REVOKE ALL PRIVILEGES ON TABLE schema_migrations FROM app_runtime,
  // information_schema.tables HIDES schema_migrations (it only lists
  // tables the current role has some privilege on). The old verifier
  // queried information_schema.tables for existence, so it reported
  // ledgerExists: false and passed VACUOUSLY — never actually checking
  // that all seven privileges were denied. The runtime-role-evidence.json
  // from the branch exercise showed exactly this false negative while
  // runtime-ledger-privileges-role-check.txt proved ledger_exists=t with
  // all seven privileges denied.
  //
  // The fix queries pg_catalog (pg_class + pg_namespace), which is a
  // system catalog visible to every role regardless of table privileges,
  // so an existing-but-inaccessible ledger is detected. This test
  // simulates the bug scenario: information_schema.tables returns EMPTY
  // for the ledger (hidden), but pg_class returns the ledger row. The
  // verifier must report ledgerExists: true and verify all seven
  // privileges are denied (not pass vacuously).
  const client = makeClient((text) => {
    // information_schema.tables must NOT be used for the existence check.
    // If it is, this mock returns empty (the bug scenario) and the test
    // fails on the ledgerExists assertion — proving the fix uses
    // pg_catalog instead.
    if (/information_schema.tables/i.test(text)) {
      return { rows: [] };
    }
    // pg_catalog existence check (pg_class + pg_namespace).
    if (/pg_class/i.test(text) && /pg_namespace/i.test(text) && /LIMIT 1/i.test(text)) {
      return { rows: [{ '?column?': 1 }] };
    }
    // All seven table privileges denied on the ledger.
    if (/has_table_privilege/i.test(text)) {
      return { rows: [{ ok: false }] };
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkCannotAccessLedger(client, 'app_runtime');
  assert.equal(
    r.ledgerExists,
    true,
    'ledger must be detected via pg_catalog even when information_schema hides it',
  );
  assert.equal(r.ok, true, 'all seven privileges denied must pass');
  assert.deepEqual(r.grantedPrivileges, []);
});

test('checkCannotAccessLedger fails when an inaccessible ledger has a residual granted privilege (regression: false-negative pass)', async () => {
  // Companion to the inaccessible-ledger regression: even when
  // information_schema hides the ledger, pg_catalog detects it, and the
  // verifier must still FAIL if any of the seven privileges is granted.
  // The old code would have passed vacuously (ledgerExists: false). The
  // fix must report ledgerExists: true and surface the granted privilege.
  const client = makeClient((text, params) => {
    if (/information_schema.tables/i.test(text)) {
      return { rows: [] };
    }
    if (/pg_class/i.test(text) && /pg_namespace/i.test(text) && /LIMIT 1/i.test(text)) {
      return { rows: [{ '?column?': 1 }] };
    }
    if (/has_table_privilege/i.test(text)) {
      const priv = params?.[2];
      // SELECT leaked through — must be caught.
      return { rows: [{ ok: priv === 'SELECT' }] };
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkCannotAccessLedger(client, 'app_runtime');
  assert.equal(r.ledgerExists, true);
  assert.equal(r.ok, false, 'a residual granted privilege must fail, not pass vacuously');
  assert.deepEqual(r.grantedPrivileges, ['SELECT']);
});

test('checkCannotAccessLedger queries pg_catalog (not information_schema) for ledger existence', async () => {
  // Structural guard: the existence check must use pg_catalog so a
  // revoked ledger is never hidden. Verify the issued SQL hits pg_class
  // and does NOT hit information_schema.tables for the existence probe.
  const client = makeClient((text) => {
    if (/information_schema.tables/i.test(text)) {
      throw new Error('existence check must NOT query information_schema.tables');
    }
    if (/pg_class/i.test(text) && /pg_namespace/i.test(text) && /LIMIT 1/i.test(text)) {
      return { rows: [{ '?column?': 1 }] };
    }
    if (/has_table_privilege/i.test(text)) {
      return { rows: [{ ok: false }] };
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkCannotAccessLedger(client, 'app_runtime');
  assert.equal(r.ledgerExists, true);
  assert.equal(r.ok, true);
  // Confirm a pg_class existence query was actually issued.
  assert.equal(
    client.calls.some((c) => /pg_class/i.test(c.text) && /pg_namespace/i.test(c.text)),
    true,
    'a pg_class/pg_namespace existence query must be issued',
  );
});

// ---------------------------------------------------------------------------
// checkSequencePrivileges (catalog only, no nextval)
// ---------------------------------------------------------------------------

test('checkSequencePrivileges passes when USAGE and SELECT are granted', async () => {
  const client = makeClient((text) => {
    if (/information_schema.sequences/i.test(text)) {
      return { rows: [{ sequence_name: 'orgs_id_seq' }] };
    }
    if (/has_sequence_privilege/i.test(text)) {
      return { rows: [{ ok: true }] };
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkSequencePrivileges(client, 'app_runtime');
  assert.equal(r.ok, true);
  assert.equal(r.checked, 1);
});

test('checkSequencePrivileges fails and lists the missing privilege', async () => {
  const client = makeClient((text, params) => {
    if (/information_schema.sequences/i.test(text)) {
      return { rows: [{ sequence_name: 'orgs_id_seq' }] };
    }
    if (/has_sequence_privilege/i.test(text)) {
      const priv = params?.[2];
      return { rows: [{ ok: priv !== 'USAGE' }] };
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkSequencePrivileges(client, 'app_runtime');
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['orgs_id_seq:USAGE']);
});

test('checkSequencePrivileges never calls nextval (regression: sequence non-use)', async () => {
  // The old checkCanUseSequence called nextval, permanently advancing
  // the sequence. The catalog-level check must NOT call nextval.
  const client = makeClient((text) => {
    if (/information_schema.sequences/i.test(text)) {
      return { rows: [{ sequence_name: 'orgs_id_seq' }] };
    }
    if (/has_sequence_privilege/i.test(text)) {
      return { rows: [{ ok: true }] };
    }
    if (/nextval/i.test(text)) {
      throw new Error('nextval must NOT be called by checkSequencePrivileges');
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkSequencePrivileges(client, 'app_runtime');
  assert.equal(r.ok, true);
  // Verify no nextval call was made.
  assert.equal(
    client.calls.some((c) => /nextval/i.test(c.text)),
    false,
  );
});

// ---------------------------------------------------------------------------
// checkFunctionPrivileges
// ---------------------------------------------------------------------------

test('checkFunctionPrivileges passes when EXECUTE is granted on every function', async () => {
  const client = makeClient((text) => {
    if (/pg_proc/i.test(text)) {
      return { rows: [{ oid: '12345', name: 'handle_event' }] };
    }
    if (/has_function_privilege/i.test(text)) {
      return { rows: [{ ok: true }] };
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkFunctionPrivileges(client, 'app_runtime');
  assert.equal(r.ok, true);
  assert.equal(r.checked, 1);
});

test('checkFunctionPrivileges fails and lists the missing function', async () => {
  const client = makeClient((text) => {
    if (/pg_proc/i.test(text)) {
      return { rows: [{ oid: '12345', name: 'handle_event' }] };
    }
    if (/has_function_privilege/i.test(text)) {
      return { rows: [{ ok: false }] };
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkFunctionPrivileges(client, 'app_runtime');
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['handle_event(12345)']);
});

// ---------------------------------------------------------------------------
// checkCanWrite (active probe: reserved negative ID, no sequence use)
// ---------------------------------------------------------------------------

test('checkCanWrite passes when INSERT/UPDATE/DELETE all succeed', async () => {
  const client = makeClient((text) => {
    if (/^BEGIN$/i.test(text.trim())) return { rows: [] };
    if (/^ROLLBACK$/i.test(text.trim())) return { rows: [] };
    if (/INSERT INTO tier_feature_flags/i.test(text)) return { rows: [] };
    if (/UPDATE tier_feature_flags/i.test(text)) return { rows: [] };
    if (/DELETE FROM tier_feature_flags/i.test(text)) return { rows: [] };
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkCanWrite(client);
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
});

test('checkCanWrite fails when INSERT is denied', async () => {
  const client = makeClient((text) => {
    if (/^BEGIN$/i.test(text.trim())) return { rows: [] };
    if (/^ROLLBACK$/i.test(text.trim())) return { rows: [] };
    if (/INSERT INTO tier_feature_flags/i.test(text)) {
      throw new Error('permission denied for table tier_feature_flags');
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkCanWrite(client);
  assert.equal(r.ok, false);
  assert.match(r.error, /permission denied/);
});

test('checkCanWrite supplies a reserved negative ID and does NOT call nextval (regression: sequence non-use)', async () => {
  // The probe must use an explicit negative id so the serial sequence
  // is NOT advanced. Verify the INSERT includes id = -1 (passed as a
  // parameter) and no nextval query is issued.
  const client = makeClient((text, params) => {
    if (/^BEGIN$/i.test(text.trim())) return { rows: [] };
    if (/^ROLLBACK$/i.test(text.trim())) return { rows: [] };
    if (/INSERT INTO tier_feature_flags/i.test(text)) {
      // The first parameter must be the reserved negative ID.
      assert.equal(params?.[0], PROBE_RESERVED_ID);
      assert.equal(params?.[0], -1);
      // The INSERT must specify the id column explicitly.
      assert.match(text, /\bid\b/i);
      return { rows: [] };
    }
    if (/UPDATE tier_feature_flags/i.test(text)) {
      assert.equal(params?.[0], PROBE_RESERVED_ID);
      return { rows: [] };
    }
    if (/DELETE FROM tier_feature_flags/i.test(text)) {
      assert.equal(params?.[0], PROBE_RESERVED_ID);
      return { rows: [] };
    }
    if (/nextval/i.test(text)) {
      throw new Error('checkCanWrite must NOT call nextval');
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkCanWrite(client);
  assert.equal(r.ok, true);
  assert.equal(
    client.calls.some((c) => /nextval/i.test(c.text)),
    false,
    'no nextval query should be issued',
  );
});

test('checkCanWrite redacts a connection string leaked in a probe error (regression: nested-error redaction)', async () => {
  const client = makeClient((text) => {
    if (/^BEGIN$/i.test(text.trim())) return { rows: [] };
    if (/^ROLLBACK$/i.test(text.trim())) return { rows: [] };
    if (/INSERT INTO tier_feature_flags/i.test(text)) {
      throw new Error('link postgresql://app_runtime:leakedpw@ep-host.neon.tech/neondb failed');
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await checkCanWrite(client);
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.error, /leakedpw/);
  assert.match(r.error, /\[redacted\]/);
});

// ---------------------------------------------------------------------------
// runAllChecks
// ---------------------------------------------------------------------------

test('runAllChecks (read-only mode) skips active probes and returns ok=true when catalog checks pass', async () => {
  const client = makeClient((text, params) => {
    if (/SELECT current_user/i.test(text)) {
      return { rows: [{ role: 'app_runtime' }] };
    }
    if (/pg_has_role.*neon_superuser/i.test(text)) {
      return { rows: [{ is_member: false }] };
    }
    if (/has_schema_privilege.*CREATE/i.test(text)) {
      return { rows: [{ can_create: false }] };
    }
    if (/pg_class/i.test(text) && /relkind/i.test(text)) {
      return { rows: [{ table_name: 'organizations', owner: 'neondb_owner' }] };
    }
    if (/pg_has_role/i.test(text)) {
      return { rows: [{ is_member: false }] };
    }
    if (/pg_class/i.test(text) && /pg_namespace/i.test(text) && /LIMIT 1/i.test(text)) {
      // ledger exists check (pg_catalog — visible even after REVOKE)
      return { rows: [{ '?column?': 1 }] };
    }
    if (/information_schema.tables/i.test(text)) {
      return { rows: [{ table_name: 'organizations' }] };
    }
    if (/has_table_privilege/i.test(text)) {
      // Distinguish ledger (deny all) from regular tables (grant DML).
      const table = params?.[1];
      if (table === LEDGER_TABLE) return { rows: [{ ok: false }] };
      return { rows: [{ ok: true }] };
    }
    if (/information_schema.sequences/i.test(text)) return { rows: [] };
    if (/pg_proc/i.test(text)) return { rows: [] };
    throw new Error(`unexpected: ${text}`);
  });
  const r = await runAllChecks(client, 'app_runtime', false);
  assert.equal(r.ok, true);
  assert.equal(r.checks.activeProbe.enabled, false);
  assert.equal(r.checks.canWrite, undefined);
  assert.equal(r.checks.cannotAlterTables, undefined);
  // No BEGIN/ROLLBACK/INSERT/ALTER should have been issued.
  assert.equal(
    client.calls.some((c) => /^BEGIN$/i.test(c.text.trim())),
    false,
  );
});

test('runAllChecks (active mode) runs the active probes', async () => {
  const client = makeClient((text, params) => {
    if (/SELECT current_user/i.test(text)) {
      return { rows: [{ role: 'app_runtime' }] };
    }
    if (/pg_has_role.*neon_superuser/i.test(text)) {
      return { rows: [{ is_member: false }] };
    }
    if (/has_schema_privilege.*CREATE/i.test(text)) {
      return { rows: [{ can_create: false }] };
    }
    if (/pg_class/i.test(text) && /relkind/i.test(text)) {
      return { rows: [{ table_name: 'tier_feature_flags', owner: 'neondb_owner' }] };
    }
    if (/pg_has_role/i.test(text)) {
      return { rows: [{ is_member: false }] };
    }
    if (/pg_class/i.test(text) && /pg_namespace/i.test(text) && /LIMIT 1/i.test(text)) {
      // ledger exists check (pg_catalog — visible even after REVOKE)
      return { rows: [{ '?column?': 1 }] };
    }
    if (/information_schema.tables/i.test(text)) {
      // tablePrivileges list AND alter-probe table lookup (both select table_name)
      return { rows: [{ table_name: 'tier_feature_flags' }] };
    }
    if (/has_table_privilege/i.test(text)) {
      const table = params?.[1];
      if (table === LEDGER_TABLE) return { rows: [{ ok: false }] };
      return { rows: [{ ok: true }] };
    }
    if (/information_schema.sequences/i.test(text)) return { rows: [] };
    if (/pg_proc/i.test(text)) return { rows: [] };
    if (/^BEGIN$/i.test(text.trim())) return { rows: [] };
    if (/^ROLLBACK$/i.test(text.trim())) return { rows: [] };
    if (/INSERT INTO tier_feature_flags/i.test(text)) return { rows: [] };
    if (/UPDATE tier_feature_flags/i.test(text)) return { rows: [] };
    if (/DELETE FROM tier_feature_flags/i.test(text)) return { rows: [] };
    if (/ALTER TABLE/i.test(text)) {
      throw pgError('permission denied', '42501');
    }
    throw new Error(`unexpected: ${text}`);
  });
  const r = await runAllChecks(client, 'app_runtime', true);
  assert.equal(r.ok, true);
  assert.equal(r.checks.activeProbe.enabled, true);
  assert.equal(r.checks.canWrite.ok, true);
  assert.equal(r.checks.cannotAlterTables.ok, true);
});

test('runAllChecks returns ok=false when the runtime role has ledger access', async () => {
  const client = makeClient((text, params) => {
    if (/SELECT current_user/i.test(text)) {
      return { rows: [{ role: 'app_runtime' }] };
    }
    if (/pg_has_role.*neon_superuser/i.test(text)) {
      return { rows: [{ is_member: false }] };
    }
    if (/has_schema_privilege.*CREATE/i.test(text)) {
      return { rows: [{ can_create: false }] };
    }
    if (/pg_class/i.test(text) && /pg_namespace/i.test(text) && /LIMIT 1/i.test(text)) {
      // ledger exists check (pg_catalog — visible even after REVOKE)
      return { rows: [{ '?column?': 1 }] };
    }
    if (/pg_class/i.test(text) && /relkind/i.test(text)) {
      return { rows: [] };
    }
    if (/information_schema.tables/i.test(text)) {
      return { rows: [] };
    }
    if (/has_table_privilege/i.test(text)) {
      // The ledger check: grant SELECT on schema_migrations.
      const priv = params?.[2];
      const role = params?.[0];
      if (role === 'app_runtime' && priv === 'SELECT') {
        return { rows: [{ ok: true }] };
      }
      return { rows: [{ ok: false }] };
    }
    if (/information_schema.sequences/i.test(text)) return { rows: [] };
    if (/pg_proc/i.test(text)) return { rows: [] };
    throw new Error(`unexpected: ${text}`);
  });
  const r = await runAllChecks(client, 'app_runtime', false);
  assert.equal(r.ok, false);
  assert.equal(r.checks.ledgerAccessDenied.ok, false);
  assert.deepEqual(r.checks.ledgerAccessDenied.grantedPrivileges, ['SELECT']);
});

test('runAllChecks returns ok=false when role does not match expected', async () => {
  const client = makeClient((text) => {
    if (/SELECT current_user/i.test(text)) {
      return { rows: [{ role: 'neondb_owner' }] };
    }
    if (/pg_has_role.*neon_superuser/i.test(text)) {
      return { rows: [{ is_member: false }] };
    }
    if (/has_schema_privilege.*CREATE/i.test(text)) {
      return { rows: [{ can_create: false }] };
    }
    if (/pg_class/i.test(text)) return { rows: [] };
    if (/information_schema.tables/i.test(text)) return { rows: [] };
    if (/information_schema.sequences/i.test(text)) return { rows: [] };
    if (/pg_proc/i.test(text)) return { rows: [] };
    throw new Error(`unexpected: ${text}`);
  });
  const r = await runAllChecks(client, 'app_runtime', false);
  assert.equal(r.ok, false);
  assert.equal(r.checks.roleMatches.ok, false);
  assert.equal(r.checks.roleMatches.connected, 'neondb_owner');
});

// ---------------------------------------------------------------------------
// formatReport
// ---------------------------------------------------------------------------

test('formatReport renders PASS when all read-only checks pass', () => {
  const results = {
    ok: true,
    checks: {
      roleMatches: { ok: true, connected: 'app_runtime', expected: 'app_runtime' },
      notSuperuserMember: { ok: true, isMember: false },
      cannotCreateTables: { ok: true, canCreate: false },
      tableOwnership: { ok: true, violations: [], checked: 5 },
      tablePrivileges: { ok: true, checked: 5, missing: [] },
      ledgerAccessDenied: { ok: true, ledgerExists: true, grantedPrivileges: [] },
      sequencePrivileges: { ok: true, checked: 2, missing: [] },
      functionPrivileges: { ok: true, checked: 1, missing: [] },
      activeProbe: { enabled: false },
    },
  };
  const report = formatReport(results, { host: 'ep-test.neon.tech', database: 'neondb' });
  assert.match(report, /PASS/);
  assert.match(report, /read-only/);
  assert.match(report, /ep-test\.neon\.tech\/neondb/);
  assert.doesNotMatch(report, /FAIL/);
});

test('formatReport renders FAIL when any check fails', () => {
  const results = {
    ok: false,
    checks: {
      roleMatches: { ok: true, connected: 'app_runtime', expected: 'app_runtime' },
      notSuperuserMember: { ok: false, isMember: true },
      cannotCreateTables: { ok: true, canCreate: false },
      tableOwnership: { ok: true, violations: [], checked: 0 },
      tablePrivileges: { ok: false, checked: 3, missing: ['users:INSERT'] },
      ledgerAccessDenied: { ok: true, ledgerExists: true, grantedPrivileges: [] },
      sequencePrivileges: { ok: true, checked: 1, missing: [] },
      functionPrivileges: { ok: true, checked: 0, missing: [] },
      activeProbe: { enabled: false },
    },
  };
  const report = formatReport(results, { host: 'h', database: 'd' });
  assert.match(report, /FAIL/);
  assert.match(report, /notSuperuserMember: FAIL/);
  assert.match(report, /users:INSERT/);
});

test('formatReport renders active-probe lines when active mode is enabled', () => {
  const results = {
    ok: true,
    checks: {
      roleMatches: { ok: true, connected: 'app_runtime', expected: 'app_runtime' },
      notSuperuserMember: { ok: true, isMember: false },
      cannotCreateTables: { ok: true, canCreate: false },
      tableOwnership: { ok: true, violations: [], checked: 1 },
      tablePrivileges: { ok: true, checked: 1, missing: [] },
      ledgerAccessDenied: { ok: true, ledgerExists: true, grantedPrivileges: [] },
      sequencePrivileges: { ok: true, checked: 0, missing: [] },
      functionPrivileges: { ok: true, checked: 0, missing: [] },
      activeProbe: { enabled: true },
      canWrite: { ok: true, error: null },
      cannotAlterTables: {
        ok: true,
        table: 'organizations',
        alterSucceeded: false,
        sqlstate: '42501',
        error: null,
      },
    },
  };
  const report = formatReport(results, { host: 'h', database: 'd' });
  assert.match(report, /active-probe/);
  assert.match(report, /canWrite: PASS/);
  assert.match(report, /cannotAlterTables: PASS/);
  assert.match(report, /42501/);
});

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

/**
 * Shared harness for main() tests: wires a mock Client, captures stdout,
 * invokes main, parses the JSON evidence.
 */
async function runMain(client, env) {
  const outChunks = [];
  const ClientCtor = makeClientCtor(client);
  const code = await main(env, {
    ClientCtor,
    log: (s) => outChunks.push(s),
  });
  const out = outChunks.join('');
  let evidence;
  if (out) {
    try {
      evidence = JSON.parse(out);
    } catch {
      evidence = undefined;
    }
  }
  return { code, out, evidence };
}

test('main exits 1 when RUNTIME_ROLE_URL is missing', async () => {
  const client = makeClient([]);
  const { code, evidence } = await runMain(client, {});
  assert.equal(code, 1);
  assert.equal(evidence.ok, false);
  assert.match(evidence.error, /RUNTIME_ROLE_URL is required/);
});

test('main exits 1 when RUNTIME_ROLE_URL is invalid', async () => {
  const client = makeClient([]);
  const { code, evidence } = await runMain(client, {
    RUNTIME_ROLE_URL: 'not-a-url',
  });
  assert.equal(code, 1);
  assert.equal(evidence.ok, false);
  assert.match(evidence.error, /Invalid RUNTIME_ROLE_URL/);
});

test('main exits 0 in read-only mode when all catalog checks pass and redacts the password', async () => {
  const client = makeClient((text, params) => {
    if (/SELECT current_user/i.test(text)) {
      return { rows: [{ role: 'app_runtime' }] };
    }
    if (/pg_has_role.*neon_superuser/i.test(text)) {
      return { rows: [{ is_member: false }] };
    }
    if (/has_schema_privilege.*CREATE/i.test(text)) {
      return { rows: [{ can_create: false }] };
    }
    if (/pg_class/i.test(text) && /relkind/i.test(text)) {
      return { rows: [{ table_name: 'tier_feature_flags', owner: 'neondb_owner' }] };
    }
    if (/pg_has_role/i.test(text)) {
      return { rows: [{ is_member: false }] };
    }
    if (/pg_class/i.test(text) && /pg_namespace/i.test(text) && /LIMIT 1/i.test(text)) {
      // ledger exists check (pg_catalog — visible even after REVOKE)
      return { rows: [{ '?column?': 1 }] };
    }
    if (/information_schema.tables/i.test(text)) {
      return { rows: [{ table_name: 'tier_feature_flags' }] };
    }
    if (/has_table_privilege/i.test(text)) {
      // Distinguish ledger (deny all) from regular tables (grant DML).
      const table = params?.[1];
      if (table === LEDGER_TABLE) return { rows: [{ ok: false }] };
      return { rows: [{ ok: true }] };
    }
    if (/information_schema.sequences/i.test(text)) return { rows: [] };
    if (/pg_proc/i.test(text)) return { rows: [] };
    throw new Error(`unexpected: ${text}`);
  });
  const { code, evidence, out } = await runMain(client, {
    RUNTIME_ROLE_URL: 'postgresql://app_runtime:hunter2@ep-host.neon.tech/neondb',
  });
  assert.equal(code, 0);
  assert.equal(evidence.ok, true);
  assert.equal(evidence.mode, 'read-only');
  assert.equal(evidence.target.host, 'ep-host.neon.tech');
  assert.equal(evidence.target.database, 'neondb');
  // The password must never appear in the output.
  assert.doesNotMatch(out, /hunter2/);
  // Read-only mode must not run active probes.
  assert.equal(evidence.checks.canWrite, undefined);
  assert.equal(evidence.checks.cannotAlterTables, undefined);
});

test('main exits 0 in active mode when all checks pass', async () => {
  const client = makeClient((text, params) => {
    if (/SELECT current_user/i.test(text)) {
      return { rows: [{ role: 'app_runtime' }] };
    }
    if (/pg_has_role.*neon_superuser/i.test(text)) {
      return { rows: [{ is_member: false }] };
    }
    if (/has_schema_privilege.*CREATE/i.test(text)) {
      return { rows: [{ can_create: false }] };
    }
    if (/pg_class/i.test(text) && /relkind/i.test(text)) {
      return { rows: [{ table_name: 'tier_feature_flags', owner: 'neondb_owner' }] };
    }
    if (/pg_has_role/i.test(text)) {
      return { rows: [{ is_member: false }] };
    }
    if (/pg_class/i.test(text) && /pg_namespace/i.test(text) && /LIMIT 1/i.test(text)) {
      // ledger exists check (pg_catalog — visible even after REVOKE)
      return { rows: [{ '?column?': 1 }] };
    }
    if (/information_schema.tables/i.test(text)) {
      return { rows: [{ table_name: 'tier_feature_flags' }] };
    }
    if (/has_table_privilege/i.test(text)) {
      const table = params?.[1];
      if (table === LEDGER_TABLE) return { rows: [{ ok: false }] };
      return { rows: [{ ok: true }] };
    }
    if (/information_schema.sequences/i.test(text)) return { rows: [] };
    if (/pg_proc/i.test(text)) return { rows: [] };
    if (/^BEGIN$/i.test(text.trim())) return { rows: [] };
    if (/^ROLLBACK$/i.test(text.trim())) return { rows: [] };
    if (/INSERT INTO tier_feature_flags/i.test(text)) return { rows: [] };
    if (/UPDATE tier_feature_flags/i.test(text)) return { rows: [] };
    if (/DELETE FROM tier_feature_flags/i.test(text)) return { rows: [] };
    if (/ALTER TABLE/i.test(text)) {
      throw pgError('permission denied', '42501');
    }
    throw new Error(`unexpected: ${text}`);
  });
  const { code, evidence } = await runMain(client, {
    RUNTIME_ROLE_URL: 'postgresql://app_runtime:pw@ep-host.neon.tech/neondb',
    RUNTIME_ROLE_ACTIVE_PROBE: '1',
  });
  assert.equal(code, 0);
  assert.equal(evidence.ok, true);
  assert.equal(evidence.mode, 'active-probe');
  assert.equal(evidence.checks.canWrite.ok, true);
  assert.equal(evidence.checks.cannotAlterTables.ok, true);
});

test('main exits 1 when a catalog check fails (notSuperuserMember)', async () => {
  const client = makeClient((text) => {
    if (/SELECT current_user/i.test(text)) {
      return { rows: [{ role: 'app_runtime' }] };
    }
    if (/pg_has_role.*neon_superuser/i.test(text)) {
      return { rows: [{ is_member: true }] };
    }
    if (/has_schema_privilege.*CREATE/i.test(text)) {
      return { rows: [{ can_create: false }] };
    }
    if (/pg_class/i.test(text)) return { rows: [] };
    if (/information_schema.tables/i.test(text)) return { rows: [] };
    if (/information_schema.sequences/i.test(text)) return { rows: [] };
    if (/pg_proc/i.test(text)) return { rows: [] };
    throw new Error(`unexpected: ${text}`);
  });
  const { code, evidence } = await runMain(client, {
    RUNTIME_ROLE_URL: 'postgresql://app_runtime:pw@ep-host.neon.tech/neondb',
  });
  assert.equal(code, 1);
  assert.equal(evidence.ok, false);
  assert.equal(evidence.checks.notSuperuserMember.ok, false);
});

test('main exits 1 when the runtime role has ledger access', async () => {
  const client = makeClient((text, params) => {
    if (/SELECT current_user/i.test(text)) {
      return { rows: [{ role: 'app_runtime' }] };
    }
    if (/pg_has_role.*neon_superuser/i.test(text)) {
      return { rows: [{ is_member: false }] };
    }
    if (/has_schema_privilege.*CREATE/i.test(text)) {
      return { rows: [{ can_create: false }] };
    }
    if (/pg_class/i.test(text) && /pg_namespace/i.test(text) && /LIMIT 1/i.test(text)) {
      // ledger exists check (pg_catalog — visible even after REVOKE)
      return { rows: [{ '?column?': 1 }] };
    }
    if (/pg_class/i.test(text)) return { rows: [] };
    if (/information_schema.tables/i.test(text)) {
      return { rows: [] };
    }
    if (/has_table_privilege/i.test(text)) {
      const priv = params?.[2];
      if (priv === 'SELECT') return { rows: [{ ok: true }] };
      return { rows: [{ ok: false }] };
    }
    if (/information_schema.sequences/i.test(text)) return { rows: [] };
    if (/pg_proc/i.test(text)) return { rows: [] };
    throw new Error(`unexpected: ${text}`);
  });
  const { code, evidence } = await runMain(client, {
    RUNTIME_ROLE_URL: 'postgresql://app_runtime:pw@ep-host.neon.tech/neondb',
  });
  assert.equal(code, 1);
  assert.equal(evidence.ok, false);
  assert.equal(evidence.checks.ledgerAccessDenied.ok, false);
  assert.deepEqual(evidence.checks.ledgerAccessDenied.grantedPrivileges, ['SELECT']);
});

test('main exits 1 and redacts the password when client.connect() throws', async () => {
  const client = makeClient([]);
  client.connect = async () => {
    throw new Error('password authentication failed for user "app_runtime"');
  };
  const { code, evidence, out } = await runMain(client, {
    RUNTIME_ROLE_URL: 'postgresql://app_runtime:secret123@ep-host.neon.tech/neondb',
  });
  assert.equal(code, 1);
  assert.equal(evidence.ok, false);
  assert.equal(evidence.target.host, 'ep-host.neon.tech');
  assert.doesNotMatch(out, /secret123/);
});

test('main redacts a connection string embedded in an error message', async () => {
  const client = makeClient([]);
  client.connect = async () => {
    throw new Error('connect failed: postgresql://app_runtime:leakedpw@ep-host.neon.tech/neondb');
  };
  const { code, out } = await runMain(client, {
    RUNTIME_ROLE_URL: 'postgresql://app_runtime:pw@ep-host.neon.tech/neondb',
  });
  assert.equal(code, 1);
  assert.doesNotMatch(out, /leakedpw/);
  assert.match(out, /\[redacted\]/);
});

test('main calls client.end() even when checks throw', async () => {
  const client = makeClient(() => {
    throw new Error('query failed');
  });
  client.connect = async () => {};
  const { code } = await runMain(client, {
    RUNTIME_ROLE_URL: 'postgresql://app_runtime:pw@ep-host.neon.tech/neondb',
  });
  assert.equal(code, 1);
  assert.equal(client.ended, true);
});

test('main uses RUNTIME_ROLE_NAME when provided', async () => {
  const client = makeClient((text) => {
    if (/SELECT current_user/i.test(text)) {
      return { rows: [{ role: 'custom_runtime' }] };
    }
    if (/pg_has_role.*neon_superuser/i.test(text)) {
      return { rows: [{ is_member: false }] };
    }
    if (/has_schema_privilege.*CREATE/i.test(text)) {
      return { rows: [{ can_create: false }] };
    }
    if (/pg_class/i.test(text)) return { rows: [] };
    if (/information_schema.tables/i.test(text)) return { rows: [] };
    if (/information_schema.sequences/i.test(text)) return { rows: [] };
    if (/pg_proc/i.test(text)) return { rows: [] };
    throw new Error(`unexpected: ${text}`);
  });
  const { code, evidence } = await runMain(client, {
    RUNTIME_ROLE_URL: 'postgresql://custom_runtime:pw@ep-host.neon.tech/neondb',
    RUNTIME_ROLE_NAME: 'custom_runtime',
  });
  assert.equal(code, 0);
  assert.equal(evidence.role, 'custom_runtime');
  assert.equal(evidence.checks.roleMatches.ok, true);
});

test('main defaults expected role to app_runtime when RUNTIME_ROLE_NAME is unset', async () => {
  const client = makeClient((text) => {
    if (/SELECT current_user/i.test(text)) {
      return { rows: [{ role: 'app_runtime' }] };
    }
    if (/pg_has_role.*neon_superuser/i.test(text)) {
      return { rows: [{ is_member: false }] };
    }
    if (/has_schema_privilege.*CREATE/i.test(text)) {
      return { rows: [{ can_create: false }] };
    }
    if (/pg_class/i.test(text)) return { rows: [] };
    if (/information_schema.tables/i.test(text)) return { rows: [] };
    if (/information_schema.sequences/i.test(text)) return { rows: [] };
    if (/pg_proc/i.test(text)) return { rows: [] };
    throw new Error(`unexpected: ${text}`);
  });
  const { code, evidence } = await runMain(client, {
    RUNTIME_ROLE_URL: 'postgresql://app_runtime:pw@ep-host.neon.tech/neondb',
  });
  assert.equal(code, 0);
  assert.equal(evidence.role, DEFAULT_ROLE_NAME);
});

test('main passes the connection string to the Client constructor', async () => {
  const client = makeClient((text) => {
    if (/SELECT current_user/i.test(text)) {
      return { rows: [{ role: 'app_runtime' }] };
    }
    if (/pg_has_role.*neon_superuser/i.test(text)) {
      return { rows: [{ is_member: false }] };
    }
    if (/has_schema_privilege.*CREATE/i.test(text)) {
      return { rows: [{ can_create: false }] };
    }
    if (/pg_class/i.test(text)) return { rows: [] };
    if (/information_schema.tables/i.test(text)) return { rows: [] };
    if (/information_schema.sequences/i.test(text)) return { rows: [] };
    if (/pg_proc/i.test(text)) return { rows: [] };
    throw new Error(`unexpected: ${text}`);
  });
  const ClientCtor = makeClientCtor(client);
  await main(
    { RUNTIME_ROLE_URL: 'postgresql://app_runtime:pw@ep-host.neon.tech/neondb' },
    { ClientCtor, log: () => {} },
  );
  assert.equal(
    ClientCtor.lastConfig.connectionString,
    'postgresql://app_runtime:pw@ep-host.neon.tech/neondb',
  );
});

test('main treats RUNTIME_ROLE_ACTIVE_PROBE=false as read-only', async () => {
  const client = makeClient((text) => {
    if (/SELECT current_user/i.test(text)) {
      return { rows: [{ role: 'app_runtime' }] };
    }
    if (/pg_has_role.*neon_superuser/i.test(text)) {
      return { rows: [{ is_member: false }] };
    }
    if (/has_schema_privilege.*CREATE/i.test(text)) {
      return { rows: [{ can_create: false }] };
    }
    if (/pg_class/i.test(text)) return { rows: [] };
    if (/information_schema.tables/i.test(text)) return { rows: [] };
    if (/information_schema.sequences/i.test(text)) return { rows: [] };
    if (/pg_proc/i.test(text)) return { rows: [] };
    throw new Error(`unexpected: ${text}`);
  });
  const { code, evidence } = await runMain(client, {
    RUNTIME_ROLE_URL: 'postgresql://app_runtime:pw@ep-host.neon.tech/neondb',
    RUNTIME_ROLE_ACTIVE_PROBE: 'false',
  });
  assert.equal(code, 0);
  assert.equal(evidence.mode, 'read-only');
  assert.equal(evidence.checks.canWrite, undefined);
});

test('LEDGER_TABLE and PROBE_RESERVED_ID constants are exported', () => {
  assert.equal(LEDGER_TABLE, 'schema_migrations');
  assert.equal(PROBE_RESERVED_ID, -1);
});
