/**
 * Real-data (pglite) coverage for the two routes rehomed by task 3.1.n:
 * `GET /api/products/export-excess` and `DELETE /api/products/:id`.
 *
 * Both are steps of the documented tier-downgrade remediation flow
 * (`docs/tier-downgrade-guide.md`) and neither has a code call site, so nothing
 * but these tests exercises them. 2.5 Finding 26 is why they were rehomed
 * instead of retired.
 *
 * **Why real SQL rather than a stubbed `sql` tag.** In both methods the
 * property under test IS the SQL. `findExcessProducts` is an `OFFSET` over an
 * `ORDER BY` whose tiebreaker is the correctness claim; `deleteProduct` is a
 * single statement whose three-way outcome is decided by a CTE. A stubbed
 * driver would assert the shape of a string.
 *
 * `deleteProduct` counts the blocker explicitly rather than relying on the
 * raised `inventory_items_product_id_fkey` (ON DELETE RESTRICT), and these
 * tests assert that count. The schema now comes from `database/migrations/`,
 * so the RESTRICT is really present -- the explicit count is what keeps the
 * outcome a refusal rather than a thrown constraint error.
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

describe('Workers excess-product export and product delete (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;
  let locationId: number;

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
    await sql`DELETE FROM audit_log`;
    await sql`DELETE FROM inventory_items`;
    await sql`DELETE FROM products`;
    await sql`DELETE FROM store_areas`;
    const areaRows = await sql`
      INSERT INTO store_areas (organization_id, name, updated_at) VALUES (${ORG}, ${'Aisle 1'}, NOW()) RETURNING id`;
    locationId = Number(areaRows[0].id);
  });

  /** Insert one product with an explicit creation time, returning its id. */
  const seedProduct = async (opts: {
    name: string;
    createdAt: string;
    organizationId?: string;
    sku?: string;
    costPrice?: number;
  }): Promise<number> => {
    const org = opts.organizationId ?? ORG;
    const sku = opts.sku ?? opts.name;
    const rows = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, created_at, updated_at)
      VALUES (${org}, ${`BAR-${org}-${sku}`}, ${`SKU-${org}-${sku}`}, ${opts.name},
              ${opts.costPrice ?? 1}, ${opts.createdAt}, NOW())
      RETURNING id`;
    return Number(rows[0].id);
  };

  const seedInventory = async (productId: number, count: number, organizationId = ORG) => {
    for (let i = 0; i < count; i += 1) {
      await sql`
        INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status, updated_at)
        VALUES (${organizationId}, ${productId}, ${locationId}, ${'2027-01-01'}, ${'Active'}, NOW())`;
    }
  };

  const productExists = async (id: number): Promise<boolean> => {
    const rows = await sql`SELECT id FROM products WHERE id = ${id}`;
    return rows.length > 0;
  };

  describe('findExcessProducts', () => {
    it('keeps the oldest products and returns only the overflow, oldest first', async () => {
      const first = await seedProduct({ name: 'oldest', createdAt: '2026-01-01T00:00:00Z' });
      const second = await seedProduct({ name: 'middle', createdAt: '2026-02-01T00:00:00Z' });
      const third = await seedProduct({ name: 'newer', createdAt: '2026-03-01T00:00:00Z' });
      const fourth = await seedProduct({ name: 'newest', createdAt: '2026-04-01T00:00:00Z' });

      const excess = await makeDb().findExcessProducts(ORG, 2);

      // Identity, not count: the wrong two rows would also be length 2.
      expect(excess.map((p) => p.id)).toEqual([third, fourth]);
      expect(excess.map((p) => p.name)).toEqual(['newer', 'newest']);
      // The kept rows are the ones the customer is told they may keep.
      expect(excess.map((p) => p.id)).not.toContain(first);
      expect(excess.map((p) => p.id)).not.toContain(second);
    });

    it('partitions ties by id, so edits and vacuum do not change who is excess', async () => {
      // Bulk CSV import writes every row inside one statement, so identical
      // created_at values are the normal case here, not an edge case, and
      // `ORDER BY created_at` alone leaves their relative order undefined.
      //
      // **Reproducing that undefinedness takes a specific sequence, and writing
      // this test the obvious way produced a green that proved nothing.**
      // Running the query twice on a fresh table returns the same order every
      // time, and so does running it after an UPDATE -- the updated tuple moves
      // to the tail of the heap (verified: its ctid goes from `(0,1)` to
      // `(0,6)`), yet the planner still emits the old order. Only once the dead
      // tuples are reclaimed does the scan order actually change: after
      // `VACUUM`, an un-tiebroken query returns `3,4,5,1,2` instead of
      // `1,2,3,4,5`, moving two products from "kept" to "excess" and two the
      // other way.
      //
      // That is not a contrived step. Autovacuum runs continuously in
      // production, so the real-world version of this is a customer exporting
      // a backup, editing a couple of products, and finding that the set the
      // next export calls excess has silently changed underneath them --
      // deleting from the first backup then removes a product the system no
      // longer considers over-cap, while one that is stays.
      const sameInstant = '2026-05-05T12:00:00Z';
      const ids = [
        await seedProduct({ name: 'bulk-1', createdAt: sameInstant }),
        await seedProduct({ name: 'bulk-2', createdAt: sameInstant }),
        await seedProduct({ name: 'bulk-3', createdAt: sameInstant }),
        await seedProduct({ name: 'bulk-4', createdAt: sameInstant }),
        await seedProduct({ name: 'bulk-5', createdAt: sameInstant }),
      ];

      const before = await makeDb().findExcessProducts(ORG, 3);
      expect(before.map((p) => p.id)).toEqual([ids[3], ids[4]]);

      await sql`UPDATE products SET notes = ${'corrected'} WHERE id = ${ids[0]}`;
      await sql`UPDATE products SET notes = ${'corrected'} WHERE id = ${ids[1]}`;
      await sql`VACUUM products`;

      const after = await makeDb().findExcessProducts(ORG, 3);
      expect(after.map((p) => p.id)).toEqual([ids[3], ids[4]]);
    });

    it('reports how many inventory items hold each excess product', async () => {
      await seedProduct({ name: 'kept', createdAt: '2026-01-01T00:00:00Z' });
      const busy = await seedProduct({ name: 'busy', createdAt: '2026-02-01T00:00:00Z' });
      const idle = await seedProduct({ name: 'idle', createdAt: '2026-03-01T00:00:00Z' });
      await seedInventory(busy, 3);

      const excess = await makeDb().findExcessProducts(ORG, 1);

      const byId = new Map(excess.map((p) => [p.id, p]));
      // This column is what tells the customer which deletions will be refused.
      expect(byId.get(busy)?.inventoryCount).toBe(3);
      expect(byId.get(idle)?.inventoryCount).toBe(0);
    });

    it('returns nothing when the organization is within its cap', async () => {
      await seedProduct({ name: 'only', createdAt: '2026-01-01T00:00:00Z' });

      expect(await makeDb().findExcessProducts(ORG, 5)).toEqual([]);
    });

    it('never returns another tenant rows, and their rows do not consume the offset', async () => {
      // The foreign rows are seeded OLDEST so they sort first under the
      // ORDER BY. If the query lost its organization predicate they would fill
      // the OFFSET window and be returned in place of this tenant's overflow --
      // the assertion is on identity, so a leak cannot hide behind a row count.
      await seedProduct({
        name: 'foreign-oldest',
        createdAt: '2025-01-01T00:00:00Z',
        organizationId: OTHER_ORG,
      });
      await seedProduct({
        name: 'foreign-older',
        createdAt: '2025-02-01T00:00:00Z',
        organizationId: OTHER_ORG,
      });
      await seedProduct({ name: 'mine-1', createdAt: '2026-01-01T00:00:00Z' });
      const mine2 = await seedProduct({ name: 'mine-2', createdAt: '2026-02-01T00:00:00Z' });

      const excess = await makeDb().findExcessProducts(ORG, 1);

      expect(excess.map((p) => p.id)).toEqual([mine2]);
      expect(excess.map((p) => p.name)).not.toContain('foreign-oldest');
      expect(excess.map((p) => p.name)).not.toContain('foreign-older');
    });

    it('counts only inventory items belonging to the product, across tenants', async () => {
      await seedProduct({ name: 'kept', createdAt: '2026-01-01T00:00:00Z' });
      const mine = await seedProduct({ name: 'mine', createdAt: '2026-02-01T00:00:00Z' });
      const theirs = await seedProduct({
        name: 'theirs',
        createdAt: '2026-02-01T00:00:00Z',
        organizationId: OTHER_ORG,
      });
      await seedInventory(mine, 2);
      await seedInventory(theirs, 7, OTHER_ORG);

      const excess = await makeDb().findExcessProducts(ORG, 1);

      expect(excess.map((p) => p.id)).toEqual([mine]);
      expect(excess[0]?.inventoryCount).toBe(2);
    });
  });

  describe('deleteProduct', () => {
    it('deletes a product that nothing references', async () => {
      const id = await seedProduct({ name: 'disposable', createdAt: '2026-01-01T00:00:00Z' });

      expect(await makeDb().deleteProduct(ORG, id)).toEqual({ outcome: 'deleted' });
      expect(await productExists(id)).toBe(false);
    });

    it('reports not_found for an id that does not exist', async () => {
      expect(await makeDb().deleteProduct(ORG, 999999)).toEqual({ outcome: 'not_found' });
    });

    it('refuses a product held by inventory items, naming the count', async () => {
      const id = await seedProduct({ name: 'held', createdAt: '2026-01-01T00:00:00Z' });
      await seedInventory(id, 2);

      // Express let the ON DELETE RESTRICT constraint fire and surfaced a bare
      // 500. The count is what makes the 409 actionable.
      expect(await makeDb().deleteProduct(ORG, id)).toEqual({
        outcome: 'blocked',
        inventoryCount: 2,
      });
      expect(await productExists(id)).toBe(true);
    });

    it('deletes once the last inventory item holding the product is gone', async () => {
      const id = await seedProduct({ name: 'freed', createdAt: '2026-01-01T00:00:00Z' });
      await seedInventory(id, 1);

      expect(await makeDb().deleteProduct(ORG, id)).toMatchObject({ outcome: 'blocked' });

      await sql`DELETE FROM inventory_items WHERE product_id = ${id}`;

      expect(await makeDb().deleteProduct(ORG, id)).toEqual({ outcome: 'deleted' });
      expect(await productExists(id)).toBe(false);
    });

    it('cannot delete another tenant product, and leaves it untouched', async () => {
      const victim = await seedProduct({
        name: 'victim',
        createdAt: '2026-01-01T00:00:00Z',
        organizationId: OTHER_ORG,
      });

      // Both halves: the attacker's call had no effect AND the victim's row
      // survives. A not_found that had still deleted the row would pass the
      // first assertion alone.
      expect(await makeDb().deleteProduct(ORG, victim)).toEqual({ outcome: 'not_found' });
      expect(await productExists(victim)).toBe(true);
    });

    it('does not report another tenant product as blocked, leaking its inventory count', async () => {
      // A blocked outcome carries a number derived from rows this caller may
      // not see. The org check must decide the outcome before the count is
      // reported, or an attacker learns how much inventory a stranger holds.
      const victim = await seedProduct({
        name: 'busy-victim',
        createdAt: '2026-01-01T00:00:00Z',
        organizationId: OTHER_ORG,
      });
      await seedInventory(victim, 4, OTHER_ORG);

      expect(await makeDb().deleteProduct(ORG, victim)).toEqual({ outcome: 'not_found' });
      expect(await productExists(victim)).toBe(true);
    });
  });
});
