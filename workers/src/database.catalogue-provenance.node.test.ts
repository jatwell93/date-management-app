import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from './database';
import type { Env } from './types/env';
import {
  createPgliteHarness,
  createTaggedSql,
  type PgliteHarness,
} from './__tests__/pglite-db';

const sqlHolder = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlHolder.current),
}));

import { createWorkersDatabase } from './database';

describe('Worker catalogue provenance database', () => {
  let harness: PgliteHarness;
  let db: Database;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sqlHolder.current = createTaggedSql(harness.pg);
    db = createWorkersDatabase({
      NEON_CONNECTION_STRING: 'postgres://test',
    } as unknown as Env);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('returns latest plus twenty prior runs with normalized fields', async () => {
    for (let version = 1; version <= 22; version += 1) {
      await harness.pg.query(
        `INSERT INTO catalogue_seed_runs
          (version, seeded_at, source_file_name, inserted, updated, unchanged, retired, reinstated, error_count)
         VALUES ($1, $2, $3, $4, 0, 100, 0, 0, 0)`,
        [
          version,
          `2026-07-${String(version).padStart(2, '0')}T00:00:00.000Z`,
          `v${version}.xlsx`,
          version,
        ],
      );
    }

    const result = await db.getCatalogueProvenance();

    expect(result.latest).toMatchObject({
      version: 22,
      seededAt: '2026-07-22T00:00:00.000Z',
      inserted: 22,
    });
    expect(result.history).toHaveLength(20);
    expect(result.history[19].version).toBe(2);
  });
});
