/**
 * Real-data (pglite) coverage for `db.updateProduct`, the storage half of the
 * `PUT /api/products/:id` route rehomed by task 3.1.q.
 *
 * **Why real SQL rather than a stubbed `sql` tag.** The property under test IS
 * the SQL. The method is one `UPDATE` whose partial-update semantics are
 * carried entirely by five `COALESCE` calls, its tenant scoping by the `WHERE`,
 * and its 409 by a unique index. Against a stubbed driver every one of those
 * assertions would be a claim about the shape of a string.
 *
 * The schema comes from `database/migrations/` (replayed through the real
 * migration runner), so the two production unique indexes
 * (`UNIQUE (organization_id, sku)` / `(organization_id, barcode)`,
 * `database/migrations/0000_baseline.up.sql:370,373`) are present and the
 * conflict tests here can actually fail.
 *
 * Runs under `vitest.node.config.mts` (`*.node.test.ts`, `npm run test:db`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { Env } from './types/env';
import {
  createPgliteHarness,
  createTaggedSql,
  seedOrganization,
  type PgliteHarness,
} from './__tests__/pglite-db';

const sqlHolder = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlHolder.current),
}));

import { createWorkersDatabase } from './database';

const ORG = 'org-a';
const OTHER_ORG = 'org-b';

describe('Workers product update (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;

  const makeDb = () => createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;
    await seedOrganization(harness.pg, ORG, 'Org A');
    await seedOrganization(harness.pg, OTHER_ORG, 'Org B');
  }, 30000); // pglite WASM cold-start can exceed the default 10s hook timeout

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await sql`DELETE FROM inventory_items`;
    await sql`DELETE FROM products`;
  });

  const seedProduct = async (opts: {
    organizationId?: string;
    barcode: string;
    sku: string;
    name: string;
    costPrice?: number;
    notes?: string;
  }): Promise<number> => {
    const rows = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, notes, updated_at)
      VALUES (${opts.organizationId ?? ORG}, ${opts.barcode}, ${opts.sku}, ${opts.name},
              ${opts.costPrice ?? 5}, ${opts.notes ?? 'original notes'}, NOW())
      RETURNING id`;
    return Number(rows[0].id);
  };

  const readRow = async (id: number) => {
    const rows = await sql`
      SELECT barcode, sku, name, cost_price AS "costPrice", notes, created_at AS "createdAt",
             updated_at AS "updatedAt"
      FROM products WHERE id = ${id}`;
    return rows[0];
  };

  it('moves only the fields supplied and leaves the rest byte-identical', async () => {
    const id = await seedProduct({ barcode: '12345678', sku: 'SKU-1', name: 'Original' });
    const before = await readRow(id);

    const updated = await makeDb().updateProduct(ORG, id, { name: 'Renamed' });

    expect(updated?.name).toBe('Renamed');
    const after = await readRow(id);
    // Identity on every untouched column, not merely "the update returned a
    // row": a COALESCE written against the wrong column would still return one.
    expect(after.barcode).toBe(before.barcode);
    expect(after.sku).toBe(before.sku);
    expect(after.costPrice).toBe(before.costPrice);
    expect(after.notes).toBe(before.notes);
  });

  it('writes a cost price of zero rather than treating it as "no change"', async () => {
    // The COALESCE trap. `COALESCE(0, cost_price)` is 0 because 0 is not NULL,
    // but the same pattern written with a falsy check (`costPrice || null`) in
    // the caller would silently discard it -- and zero is a real cost price for
    // a giveaway line, so the discard would be invisible.
    const id = await seedProduct({
      barcode: '22222222',
      sku: 'SKU-2',
      name: 'Freebie',
      costPrice: 7.5,
    });

    const updated = await makeDb().updateProduct(ORG, id, { costPrice: 0 });

    expect(Number(updated?.costPrice)).toBe(0);
    expect(Number((await readRow(id)).costPrice)).toBe(0);
  });

  it('writes an empty notes string rather than treating it as "no change"', async () => {
    // Same class as the zero above, for the other falsy value in this shape.
    const id = await seedProduct({
      barcode: '33333333',
      sku: 'SKU-3',
      name: 'Notes',
      notes: 'to be cleared',
    });

    await makeDb().updateProduct(ORG, id, { notes: '' });

    expect((await readRow(id)).notes).toBe('');
  });

  it('applies every field at once', async () => {
    const id = await seedProduct({ barcode: '44444444', sku: 'SKU-4', name: 'Before' });

    const updated = await makeDb().updateProduct(ORG, id, {
      barcode: '44444445',
      sku: 'SKU-4B',
      name: 'After',
      costPrice: 12.34,
      notes: 'changed',
    });

    expect(updated).toMatchObject({ barcode: '44444445', sku: 'SKU-4B', name: 'After' });
    expect(Number(updated?.costPrice)).toBeCloseTo(12.34);
    expect(updated?.notes).toBe('changed');
  });

  it('advances updated_at and leaves created_at alone', async () => {
    const id = await seedProduct({ barcode: '55555555', sku: 'SKU-5', name: 'Timestamps' });
    const before = await readRow(id);

    const updated = await makeDb().updateProduct(ORG, id, { name: 'Touched' });

    // **Compared in SQL, strictly, and against created_at.** The first version
    // of this test read both timestamps into JS and asserted
    // `updatedAt >= before.updatedAt`, which is satisfied by a value that never
    // moved -- deleting `updated_at = NOW()` from the statement left all 11
    // tests green. Postgres keeps microseconds where `new Date()` keeps
    // milliseconds, so the comparison also belongs on this side of the wire:
    // the insert and the update are separate statements and therefore separate
    // transactions, but they are not necessarily a whole millisecond apart.
    const [{ moved, born }] = (await sql`
      SELECT updated_at > created_at AS moved,
             created_at = ${before.createdAt as string}::timestamptz AS born
      FROM products WHERE id = ${id}`) as unknown as { moved: boolean; born: boolean }[];

    expect(moved).toBe(true);
    expect(born).toBe(true);
    expect(updated?.name).toBe('Touched');
  });

  describe('tenant scoping', () => {
    it('refuses another organization’s product and does not touch the row', async () => {
      const foreign = await seedProduct({
        organizationId: OTHER_ORG,
        barcode: '66666666',
        sku: 'SKU-6',
        name: 'Not yours',
      });
      const before = await readRow(foreign);

      const result = await makeDb().updateProduct(ORG, foreign, {
        name: 'Hijacked',
        costPrice: 9999,
      });

      expect(result).toBeNull();
      // Assert the row, not just the return value: a method that returned null
      // while still writing would pass a return-value-only test.
      const after = await readRow(foreign);
      expect(after.name).toBe(before.name);
      expect(after.costPrice).toBe(before.costPrice);
    });

    // A second test here -- "updates my row when another org also has one" --
    // was written and then deleted. `products.id` is a single serial primary
    // key, so two organizations can never hold the same id and the query has
    // exactly one candidate row with or without the predicate. It could not
    // fail, which makes it a claim about tenant isolation that tests none.

    it('returns null for an id that does not exist', async () => {
      expect(await makeDb().updateProduct(ORG, 999999, { name: 'Ghost' })).toBeNull();
    });
  });

  describe('uniqueness', () => {
    it('throws when the new barcode is already used in the same organization', async () => {
      await seedProduct({ barcode: '88888888', sku: 'SKU-8', name: 'Incumbent' });
      const mover = await seedProduct({ barcode: '88888889', sku: 'SKU-8B', name: 'Mover' });

      await expect(makeDb().updateProduct(ORG, mover, { barcode: '88888888' })).rejects.toThrow();

      // The failed statement must leave the row as it was.
      expect((await readRow(mover)).barcode).toBe('88888889');
    });

    it('throws when the new sku is already used in the same organization', async () => {
      await seedProduct({ barcode: '99999990', sku: 'SKU-9', name: 'Incumbent' });
      const mover = await seedProduct({ barcode: '99999991', sku: 'SKU-9B', name: 'Mover' });

      await expect(makeDb().updateProduct(ORG, mover, { sku: 'SKU-9' })).rejects.toThrow();
    });

    it('allows a barcode that another organization already uses', async () => {
      // The unique indexes are per-organization. If this ever throws, the
      // index has been redefined without the organization_id and every tenant
      // is competing for one global barcode namespace.
      await seedProduct({
        organizationId: OTHER_ORG,
        barcode: '10101010',
        sku: 'SKU-X',
        name: 'Elsewhere',
      });
      const mine = await seedProduct({ barcode: '10101011', sku: 'SKU-Y', name: 'Mine' });

      const updated = await makeDb().updateProduct(ORG, mine, { barcode: '10101010' });

      expect(updated?.barcode).toBe('10101010');
    });
  });
});
