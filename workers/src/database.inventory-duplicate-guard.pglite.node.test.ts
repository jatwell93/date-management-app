/**
 * Real-SQL coverage for the duplicate-inventory guard (task 3.10 of
 * retire-express-unify-on-postgres, migration 0019).
 *
 * Express refused a second `inventory_items` row with the same product, expiry
 * date and location (409, `data-integrity.middleware`). The Worker inserted
 * unconditionally, and the table has no quantity column, so a duplicate counted
 * as a second unit. The rule now lives in two places that these tests pin
 * separately: a read in `createInventoryItem` that gives a precise refusal, and
 * the partial unique index `inventory_items_active_triple_unique` that closes
 * the race the read leaves open.
 *
 * The index is partial on purpose: items in a terminal status do not block
 * re-adding the same triple (reviewer decision, 2026-10-05). Express blocked on
 * any row regardless of status.
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
import { DuplicateInventoryItemError, isUniqueViolation } from './db-errors';
import { UNLIMITED_CAP } from './utils/usage-limits';

const ORG = 'org-a';
const OTHER_ORG = 'org-b';
const USER_ID = 1;
const EXPIRY = '2099-06-01';
const TERMINAL_STATUSES = ['Processed', 'Completed', 'Discarded', 'Archived', 'Sold Through'];

describe('inventory duplicate guard (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;
  let productId: number;
  let locationId: number;
  let otherLocationId: number;

  const makeDb = () => createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);

  const create = (
    overrides: Partial<{
      productId: number;
      expiryDate: string;
      locationId: number;
      status: string;
    }> = {},
    cap = UNLIMITED_CAP,
  ) =>
    makeDb().createInventoryItem(
      ORG,
      USER_ID,
      { productId, expiryDate: EXPIRY, locationId, ...overrides },
      cap,
    );

  const seedRow = async (status: string, org = ORG, location = locationId) => {
    const rows = await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status, updated_at)
      VALUES (${org}, ${productId}, ${location}, ${EXPIRY}, ${status}, NOW())
      RETURNING id`;
    return Number(rows[0].id);
  };

  const countRows = async (table: 'inventory_items' | 'audit_log') => {
    const rows =
      table === 'inventory_items'
        ? await sql`SELECT COUNT(*)::int AS count FROM inventory_items`
        : await sql`SELECT COUNT(*)::int AS count FROM audit_log`;
    return Number(rows[0].count);
  };

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;
    await sql`INSERT INTO organizations (id, name, slug, updated_at)
              VALUES (${ORG}, 'Org A', 'org-a', NOW()),
                     (${OTHER_ORG}, 'Org B', 'org-b', NOW())
              ON CONFLICT (id) DO NOTHING`;
  }, 30000);

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await sql`DELETE FROM audit_log`;
    await sql`DELETE FROM inventory_items`;
    await sql`DELETE FROM products`;
    await sql`DELETE FROM store_areas`;
    await sql`DELETE FROM users`;
    await sql`INSERT INTO users (id, organization_id, username, role, updated_at)
              VALUES (${USER_ID}, ${ORG}, ${'actor'}, ${'admin'}, NOW())`;
    const productRows = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, updated_at)
      VALUES (${ORG}, ${'BAR-DUP'}, ${'SKU-DUP'}, ${'Dup product'}, 5, NOW())
      RETURNING id`;
    productId = Number(productRows[0].id);
    const firstArea = await sql`
      INSERT INTO store_areas (organization_id, name, updated_at)
      VALUES (${ORG}, ${'Aisle 1'}, NOW()) RETURNING id`;
    const secondArea = await sql`
      INSERT INTO store_areas (organization_id, name, updated_at)
      VALUES (${ORG}, ${'Aisle 2'}, NOW()) RETURNING id`;
    locationId = Number(firstArea[0].id);
    otherLocationId = Number(secondArea[0].id);
  });

  describe('createInventoryItem', () => {
    it('refuses a second active item with the same product, expiry and location', async () => {
      const first = await create();
      expect(first).not.toBeNull();
      const auditBefore = await countRows('audit_log');

      await expect(create()).rejects.toBeInstanceOf(DuplicateInventoryItemError);

      const rows = await sql`SELECT id FROM inventory_items WHERE organization_id = ${ORG}`;
      expect(rows.map((r) => Number(r.id))).toEqual([Number(first?.id)]);
      // A refusal must not leave an orphaned 'create' audit entry.
      expect(await countRows('audit_log')).toBe(auditBefore);
    });

    it('refuses the duplicate even when the organization is at its cap', async () => {
      await create();

      // The cap would also refuse (a null return). The caller must still be
      // told it is a duplicate, because the handler answers the two differently.
      await expect(create({}, 1)).rejects.toBeInstanceOf(DuplicateInventoryItemError);
    });

    it('admits the same product and expiry at a second location', async () => {
      const first = await create();
      const second = await create({ locationId: otherLocationId });

      expect(second).not.toBeNull();
      expect(Number(second?.id)).not.toBe(Number(first?.id));
      expect(Number(second?.locationId)).toBe(otherLocationId);
    });

    it('admits the same product and location with a different expiry', async () => {
      await create();
      const second = await create({ expiryDate: '2099-06-02' });

      expect(second).not.toBeNull();
      expect(await countRows('inventory_items')).toBe(2);
    });

    it.each(TERMINAL_STATUSES)(
      'a %s item does not block re-adding the same triple',
      async (status) => {
        const retiredId = await seedRow(status);

        const fresh = await create();

        expect(fresh).not.toBeNull();
        expect(Number(fresh?.id)).not.toBe(retiredId);
        expect(fresh?.status).toBe('Normal');
      },
    );

    it('does not check an item created directly in a terminal status', async () => {
      await create();

      const retired = await create({ status: 'Discarded' });

      expect(retired).not.toBeNull();
      expect(retired?.status).toBe('Discarded');
    });

    it('treats a non-terminal status such as Expired as active', async () => {
      await seedRow('Expired');

      await expect(create()).rejects.toBeInstanceOf(DuplicateInventoryItemError);
    });

    it('does not let another organization hold the key', async () => {
      // The tenant check refuses a foreign product at the application layer, so
      // seed the foreign row directly: this asserts the index key itself is
      // scoped by organization, not just that the Worker never writes across it.
      const foreignId = await seedRow('Normal', OTHER_ORG);

      const mine = await create();

      expect(mine).not.toBeNull();
      expect(Number(mine?.id)).not.toBe(foreignId);
      const owners = await sql`
        SELECT organization_id FROM inventory_items WHERE id = ${Number(mine?.id)}`;
      expect(owners[0].organization_id).toBe(ORG);
    });
  });

  describe('inventory_items_active_triple_unique', () => {
    it('stops a duplicate that slips past the read, as a unique violation', async () => {
      await seedRow('Normal');

      // Direct INSERT stands in for the concurrent request that passed the
      // `createInventoryItem` read before the first insert committed.
      let caught: unknown;
      try {
        await seedRow('Normal');
      } catch (error) {
        caught = error;
      }

      expect(isUniqueViolation(caught)).toBe(true);
      expect(await countRows('inventory_items')).toBe(1);
    });

    it('is the only thing stopping that direct duplicate: it exists and is partial', async () => {
      const rows = await sql`
        SELECT indexdef FROM pg_indexes
        WHERE tablename = 'inventory_items' AND indexname = 'inventory_items_active_triple_unique'`;
      expect(rows).toHaveLength(1);
      expect(String(rows[0].indexdef)).toContain('UNIQUE');
      expect(String(rows[0].indexdef)).toContain(
        'organization_id, product_id, expiry_date, location_id',
      );
    });

    it('lets many retired rows share a triple', async () => {
      await seedRow('Discarded');
      await seedRow('Discarded');
      await seedRow('Sold Through');

      expect(await countRows('inventory_items')).toBe(3);
    });
  });

  describe('updateInventoryItem', () => {
    it('hits the index when a move lands on another active item', async () => {
      await seedRow('Normal', ORG, locationId);
      const movingId = await seedRow('Normal', ORG, otherLocationId);

      let caught: unknown;
      try {
        await makeDb().updateInventoryItem(ORG, USER_ID, movingId, { locationId });
      } catch (error) {
        caught = error;
      }

      expect(isUniqueViolation(caught)).toBe(true);
      const rows = await sql`SELECT location_id FROM inventory_items WHERE id = ${movingId}`;
      expect(Number(rows[0].location_id)).toBe(otherLocationId);
    });

    it('hits the index when a retired item is reinstated over an active one', async () => {
      await seedRow('Normal');
      const retiredId = await seedRow('Discarded');

      let caught: unknown;
      try {
        await makeDb().updateInventoryItem(ORG, USER_ID, retiredId, { status: 'Normal' });
      } catch (error) {
        caught = error;
      }

      expect(isUniqueViolation(caught)).toBe(true);
    });

    it('still allows a change between active statuses', async () => {
      const id = await seedRow('Normal');

      const updated = await makeDb().updateInventoryItem(ORG, USER_ID, id, {
        status: 'Markdown 1',
      });

      expect(updated?.status).toBe('Markdown 1');
    });
  });
});
