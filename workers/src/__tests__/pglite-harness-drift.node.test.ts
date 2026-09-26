/**
 * Drift test for the pglite harness (task 3.5).
 *
 * The harness schema is built by replaying `database/migrations/` through the
 * real migration runner, then cloned per suite via `loadDataDir` snapshots.
 * This test verifies the *cloned* schema (second factory call, exercising the
 * snapshot path) matches the checked-in catalog fingerprint exactly — the same
 * layer-1 assertions as `src/database/migrations/baseline.fingerprint.test.ts`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  introspectCatalog,
  normalizeCatalog,
  type NormalizedCatalog,
} from '../../../src/database/migrations/catalog-introspection';
import { loadMigrationHistory } from '../../../src/database/migrations/runner';
import { createPgliteHarness, type PgliteHarness } from './pglite-db';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../database/migrations',
);
const FINGERPRINT_PATH = path.join(MIGRATIONS_DIR, 'catalog-fingerprint.json');

describe('pglite harness schema drift', () => {
  let harness: PgliteHarness;

  it('cloned harness catalog matches the checked-in fingerprint exactly', async () => {
    // First call builds (or reuses) the migrated snapshot; the second call
    // clones it via loadDataDir — that clone is what the suites run against.
    const first = await createPgliteHarness();
    await first.close();
    harness = await createPgliteHarness();
    try {
      const catalog = await introspectCatalog({
        query: async (text: string) => {
          const result = await harness.pg.query(text);
          return { rows: result.rows as unknown[] };
        },
      });
      const normalized = normalizeCatalog(catalog);
      const expected = JSON.parse(readFileSync(FINGERPRINT_PATH, 'utf8')) as NormalizedCatalog;

      expect(normalized.tables).toEqual(expected.tables);
      expect(normalized.columns).toEqual(expected.columns);
      expect(normalized.indexes).toEqual(expected.indexes);
      expect(normalized.constraints).toEqual(expected.constraints);
      expect(normalized.functions).toEqual(expected.functions);
      expect(normalized.triggers).toEqual(expected.triggers);
    } finally {
      await harness.close();
    }
  }, 120_000);

  it('pins the session and the test process to UTC', async () => {
    const h = await createPgliteHarness();
    try {
      const rows = await h.pg.query<{ TimeZone: string }>('SHOW TimeZone');
      expect(rows.rows[0].TimeZone).toBe('UTC');
    } finally {
      await h.close();
    }
    // TZ=UTC is set in vitest.node.config.mts — verify winter and summer dates
    // both report zero offset.
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(0);
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(0);
  });

  it('records every manifest migration in the ledger, in order', async () => {
    const h = await createPgliteHarness();
    try {
      const history = await loadMigrationHistory(MIGRATIONS_DIR);
      const rows = await h.pg.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id');
      expect(rows.rows.map((row) => row.id)).toEqual(history.map(({ id }) => id));
    } finally {
      await h.close();
    }
  });

  it(
    'honours the through option and rejects unknown migration ids',
    // A fresh `through` value triggers a second migration replay (the snapshot
    // is memoized per `through`), which can exceed the default 5s timeout.
    { timeout: 120000 },
    async () => {
      const h = await createPgliteHarness({ through: '0013' });
      try {
        const rows = await h.pg.query<{ id: string }>(
          'SELECT id FROM schema_migrations ORDER BY id',
        );
        const ids = rows.rows.map((row) => row.id);
        expect(ids[ids.length - 1]).toBe('0013');
        expect(ids).not.toContain('0014');
      } finally {
        await h.close();
      }
      await expect(createPgliteHarness({ through: '9999' })).rejects.toThrow(/9999/);
    },
  );
});
