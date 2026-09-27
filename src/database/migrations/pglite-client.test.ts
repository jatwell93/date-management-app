/**
 * Unit tests for the shared pglite MigrationClient adapter.
 *
 * The routing rule is: parameterized statements always use `pg.query`,
 * parameterless `SELECT` statements use `pg.query`, and everything else uses
 * `pg.exec` (which accepts multi-statement SQL that `query` rejects). The exec
 * branch returns the LAST result's rows so row-returning statements that do
 * not literally start with SELECT — a CTE `WITH ... SELECT`, `SHOW`, or a
 * statement behind a leading comment — are not silently dropped.
 *
 * pglite is ESM-only while this package compiles to CommonJS, so it is loaded
 * via dynamic `import()` exactly like `baseline.fingerprint.test.ts`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { MigrationClient } from './runner';
import { createPgliteMigrationClient, type PgliteInstance } from './pglite-client';

async function createPglite(): Promise<{ pg: PgliteInstance; client: MigrationClient }> {
  const mod = (await import('@electric-sql/pglite')) as {
    PGlite: new () => PgliteInstance;
  };
  const pg = new mod.PGlite();
  return { pg, client: createPgliteMigrationClient(pg) };
}

test('exec branch returns rows for a leading WITH ... SELECT CTE', async () => {
  const { pg, client } = await createPglite();
  try {
    const result = await client.query('WITH x AS (SELECT 1 AS n) SELECT n FROM x');
    assert.deepEqual(result.rows, [{ n: 1 }]);
  } finally {
    await pg.close();
  }
});

test('exec branch returns rows when a leading comment precedes SELECT', async () => {
  const { pg, client } = await createPglite();
  try {
    const result = await client.query('-- comment\nSELECT 2 AS n');
    assert.deepEqual(result.rows, [{ n: 2 }]);
  } finally {
    await pg.close();
  }
});

test('exec branch returns rows for SHOW', async () => {
  const { pg, client } = await createPglite();
  try {
    const result = await client.query('SHOW TimeZone');
    assert.equal(result.rows.length, 1);
    // pglite's session timezone is host-dependent — assert the row survives,
    // not a particular zone name.
    assert.equal(typeof (result.rows[0] as Record<string, unknown>).TimeZone, 'string');
  } finally {
    await pg.close();
  }
});

test('exec branch still runs multi-statement DDL and returns no rows', async () => {
  const { pg, client } = await createPglite();
  try {
    const result = await client.query(
      'CREATE TABLE pglite_client_t (id int); INSERT INTO pglite_client_t VALUES (1);',
    );
    assert.deepEqual(result.rows, []);
    const check = await client.query('SELECT id FROM pglite_client_t');
    assert.deepEqual(check.rows, [{ id: 1 }]);
  } finally {
    await pg.close();
  }
});

test('parameterized statements still go through pg.query', async () => {
  const { pg, client } = await createPglite();
  try {
    const result = await client.query('SELECT $1::int AS n', [42]);
    assert.deepEqual(result.rows, [{ n: 42 }]);
  } finally {
    await pg.close();
  }
});
