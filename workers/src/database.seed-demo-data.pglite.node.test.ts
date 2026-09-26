/**
 * Real-data (pglite) coverage for `db.seedDemoData`, the storage half of the
 * `POST /api/organization/seed-demo-data` route rehomed by task 3.1.r.
 *
 * **Why real SQL rather than a stubbed `sql` tag.** The whole method is one
 * statement, and every property worth asserting lives inside it: the chained
 * CTEs, two `ON CONFLICT DO NOTHING` clauses whose idempotency depends on
 * indexes actually existing, a `COALESCE` that has to find rows a previous run
 * inserted, and a `NOT EXISTS` guard on the one leg no constraint protects.
 * Against a stubbed driver all of that collapses into assertions about a
 * string.
 *
 * The harness gained `store_areas_organization_id_name_sub_department_key` for
 * these tests -- production has carried it since the baseline
 * (`database/migrations/0000_baseline.up.sql:397`) and the harness did not, so
 * before that fix the idempotency tests below would have passed against code
 * with no `ON CONFLICT` clause at all.
 *
 * Runs under `vitest.node.config.mts` (`*.node.test.ts`, `npm run test:db`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { Env } from './types/env';
import { createPgliteHarness, createTaggedSql, type PgliteHarness } from './__tests__/pglite-db';

const sqlHolder = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlHolder.current),
}));

import { createWorkersDatabase } from './database';

const ORG = 'org-a';
const OTHER_ORG = 'org-b';

describe('Workers seedDemoData (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;

  const makeDb = () => createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;
  }, 30000); // pglite WASM cold-start can exceed the default 10s hook timeout

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await sql`DELETE FROM inventory_items`;
    await sql`DELETE FROM products`;
    await sql`DELETE FROM store_areas`;
  });

  // Three literal queries rather than one interpolated table name: the harness's
  // tagged-template shim rewrites every interpolation to a positional
  // parameter, so a table name passed through it would arrive as a string
  // literal, not an identifier.
  const countRows = async (table: 'products' | 'store_areas' | 'inventory_items', org = ORG) => {
    const rows =
      table === 'products'
        ? await sql`SELECT COUNT(*)::int AS count FROM products WHERE organization_id = ${org}`
        : table === 'store_areas'
          ? await sql`SELECT COUNT(*)::int AS count FROM store_areas WHERE organization_id = ${org}`
          : await sql`SELECT COUNT(*)::int AS count FROM inventory_items WHERE organization_id = ${org}`;
    return Number(rows[0].count);
  };

  it('creates three areas, eight products and eight inventory items on a fresh organization', async () => {
    const result = await makeDb().seedDemoData(ORG);

    expect(result).toEqual({
      success: true,
      areasCreated: 3,
      productsCreated: 8,
      inventoryItemsCreated: 8,
    });
    expect(await countRows('store_areas')).toBe(3);
    expect(await countRows('products')).toBe(8);
    expect(await countRows('inventory_items')).toBe(8);
  });

  it('writes every inventory item at status Normal and at a future expiry, and spreads the dates', async () => {
    await makeDb().seedDemoData(ORG);

    // Asserted in SQL rather than by comparing to a JS `new Date()`: the
    // harness declares expiry_date as DATE where production declares
    // TIMESTAMP(3), and Postgres keeps microseconds where `new Date()` keeps
    // milliseconds. Both differences make a JS-side comparison a test of the
    // conversion rather than of the data.
    const rows = await sql`
      SELECT status,
             (expiry_date > CURRENT_DATE) AS "inFuture",
             EXTRACT(YEAR FROM expiry_date) * 12 + EXTRACT(MONTH FROM expiry_date)
               - (EXTRACT(YEAR FROM CURRENT_DATE) * 12 + EXTRACT(MONTH FROM CURRENT_DATE))
               AS "monthsOut"
      FROM inventory_items
      WHERE organization_id = ${ORG}`;

    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.status === 'Normal')).toBe(true);
    expect(rows.every((r) => r.inFuture === true)).toBe(true);
    expect([...new Set(rows.map((r) => Number(r.monthsOut)))].sort((a, b) => a - b)).toEqual([
      3, 6, 18,
    ]);
  });

  it('is idempotent: a second seed of the same organization creates nothing', async () => {
    const db = makeDb();
    await db.seedDemoData(ORG);

    const second = await db.seedDemoData(ORG);

    expect(second).toEqual({
      success: true,
      areasCreated: 0,
      productsCreated: 0,
      inventoryItemsCreated: 0,
    });
    // Counts, not just the reported zeros: a missing ON CONFLICT would report
    // rows created AND leave duplicates behind, and a report of 0 with
    // duplicates present would be worse than either.
    expect(await countRows('store_areas')).toBe(3);
    expect(await countRows('products')).toBe(8);
    expect(await countRows('inventory_items')).toBe(8);
  });

  it('attaches products to an area a previous run already created', async () => {
    // The pre-existing area is the one three of the eight products reference.
    // If the resolver only saw rows THIS statement inserted, their area id
    // would be NULL and their inventory items would be dropped by the
    // `WHERE a.id IS NOT NULL` guard -- 5 items instead of 8.
    const existing = await sql`
      INSERT INTO store_areas (organization_id, name, sub_department)
      VALUES (${ORG}, 'Front Shelf', 'Over-the-Counter')
      RETURNING id`;
    const existingId = Number(existing[0].id);

    const result = await makeDb().seedDemoData(ORG);

    expect(result.areasCreated).toBe(2);
    expect(result.inventoryItemsCreated).toBe(8);

    const attached = await sql`
      SELECT COUNT(*)::int AS count FROM inventory_items
      WHERE organization_id = ${ORG} AND location_id = ${existingId}`;
    expect(Number(attached[0].count)).toBe(3);
  });

  it('skips a demo barcode already held under a different sku instead of failing the whole seed', async () => {
    // A targeted `ON CONFLICT (organization_id, sku)` would raise here: the sku
    // does not collide, the barcode does, and one raised unique violation takes
    // down every other insert in the statement.
    await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price)
      VALUES (${ORG}, '123456789012', 'PRE-EXISTING-SKU', 'Customer product', 9.99)`;

    const result = await makeDb().seedDemoData(ORG);

    expect(result.areasCreated).toBe(3);
    expect(result.productsCreated).toBe(7);
    // The skipped product gets no inventory item either.
    expect(result.inventoryItemsCreated).toBe(7);

    // The customer's row is untouched -- neither renamed nor repriced.
    const kept = await sql`
      SELECT name, cost_price AS "costPrice" FROM products
      WHERE organization_id = ${ORG} AND sku = 'PRE-EXISTING-SKU'`;
    expect(kept[0].name).toBe('Customer product');
    expect(Number(kept[0].costPrice)).toBe(9.99);

    const seededSkus = await sql`
      SELECT COUNT(*)::int AS count FROM products
      WHERE organization_id = ${ORG} AND sku = 'VIT-C-500'`;
    expect(Number(seededSkus[0].count)).toBe(0);
  });

  it('does not re-create an inventory item for a product/area pair that already has one', async () => {
    const db = makeDb();
    await db.seedDemoData(ORG);

    // Delete one item, then re-seed: exactly that one comes back. The
    // NOT EXISTS guard is the only thing stopping the other seven from being
    // duplicated, because inventory_items has no unique index over
    // (organization_id, product_id, location_id) in production either.
    await sql`
      DELETE FROM inventory_items
      WHERE organization_id = ${ORG}
        AND product_id = (SELECT id FROM products WHERE organization_id = ${ORG} AND sku = 'EPI-300')`;
    expect(await countRows('inventory_items')).toBe(7);

    const second = await db.seedDemoData(ORG);

    expect(second.inventoryItemsCreated).toBe(1);
    expect(await countRows('inventory_items')).toBe(8);
  });

  it('seeds only the organization asked for, and seeds each organization independently', async () => {
    const db = makeDb();

    await db.seedDemoData(ORG);

    expect(await countRows('products', OTHER_ORG)).toBe(0);
    expect(await countRows('store_areas', OTHER_ORG)).toBe(0);
    expect(await countRows('inventory_items', OTHER_ORG)).toBe(0);

    // The second organization must get its OWN rows despite every name, sku and
    // barcode colliding with the first organization's: both unique indexes are
    // per-organization, so an ON CONFLICT clause that ignored organization_id
    // would silently seed nothing here and report success.
    const other = await db.seedDemoData(OTHER_ORG);
    expect(other).toEqual({
      success: true,
      areasCreated: 3,
      productsCreated: 8,
      inventoryItemsCreated: 8,
    });

    // Identity, not count: assert the second organization's inventory items
    // point at the second organization's own products and areas.
    const crossed = await sql`
      SELECT COUNT(*)::int AS count
      FROM inventory_items ii
      JOIN products p ON p.id = ii.product_id
      JOIN store_areas sa ON sa.id = ii.location_id
      WHERE ii.organization_id = ${OTHER_ORG}
        AND (p.organization_id <> ${OTHER_ORG} OR sa.organization_id <> ${OTHER_ORG})`;
    expect(Number(crossed[0].count)).toBe(0);
  });

  it('re-seeding a second organization resolves ITS rows, not the first organization’s', async () => {
    // This is the case that reaches the resolvers' fallback branch across a
    // tenant boundary, and the test above does not. On a FIRST seed every
    // insert succeeds, so `COALESCE(inserted.id, existing.id)` never consults
    // the existing-row side and an untenanted join there is invisible -- which
    // is exactly what happened: dropping `ep.organization_id = ...` left all
    // seven other tests green.
    //
    // On a SECOND seed the inserts are skipped, the fallback side is the only
    // source of ids, and a join on sku alone matches BOTH organizations' rows:
    // the second organization's inventory then points at the first
    // organization's products.
    const db = makeDb();
    await db.seedDemoData(ORG);
    await db.seedDemoData(OTHER_ORG);

    const again = await db.seedDemoData(OTHER_ORG);

    expect(again).toEqual({
      success: true,
      areasCreated: 0,
      productsCreated: 0,
      inventoryItemsCreated: 0,
    });

    const crossed = await sql`
      SELECT COUNT(*)::int AS count
      FROM inventory_items ii
      JOIN products p ON p.id = ii.product_id
      JOIN store_areas sa ON sa.id = ii.location_id
      WHERE ii.organization_id = ${OTHER_ORG}
        AND (p.organization_id <> ${OTHER_ORG} OR sa.organization_id <> ${OTHER_ORG})`;
    expect(Number(crossed[0].count)).toBe(0);
    expect(await countRows('inventory_items', OTHER_ORG)).toBe(8);
  });
});
