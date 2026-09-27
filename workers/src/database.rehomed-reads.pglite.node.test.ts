/**
 * Real-data (pglite) coverage for the three read-only methods rehomed by task
 * 3.1.r: `findStoreAreaById` (`GET /api/store-areas/:id`), `getUsageReport`
 * (`GET /api/reports/usage`) and `getDashboardAnalytics`
 * (`GET /api/reports/analytics`).
 *
 * **Why real SQL rather than a stubbed `sql` tag.** All three ARE queries: a
 * tenant-scoped `WHERE`, a `LEFT JOIN` with `COALESCE` grouping and four
 * `FILTER` counters, and six more `FILTER` counters over a date window. Against
 * a stub, each assertion would describe a string rather than the rows it
 * selects.
 *
 * Two of these were ported from SQLite, whose `LIKE` is case-insensitive where
 * Postgres's is not. Rather than assume the difference is harmless, the tests
 * seed the descriptions and statuses the live writers actually produce, so the
 * port is pinned to the data instead of to a reading of the SQL.
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

describe('Workers rehomed read queries (real SQL)', () => {
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
    await sql`DELETE FROM audit_log`;
    await sql`DELETE FROM inventory_items`;
    await sql`DELETE FROM products`;
    await sql`DELETE FROM store_areas`;
    await sql`DELETE FROM users`;
    defaultAreaByOrg.clear();
  });

  const seedArea = async (opts: {
    organizationId?: string;
    name: string;
    subDepartment?: string;
  }): Promise<number> => {
    const rows = await sql`
      INSERT INTO store_areas (organization_id, name, sub_department, updated_at)
      VALUES (${opts.organizationId ?? ORG}, ${opts.name}, ${opts.subDepartment ?? 'Ambient'}, NOW())
      RETURNING id`;
    return Number(rows[0].id);
  };

  const seedUser = async (role: string, organizationId = ORG): Promise<number> => {
    const rows = await sql`
      INSERT INTO users (organization_id, role, email, updated_at)
      VALUES (${organizationId}, ${role}, ${`${role}-${organizationId}@example.test`}, NOW())
      RETURNING id`;
    return Number(rows[0].id);
  };

  const seedAuditRow = async (opts: {
    organizationId?: string;
    userId?: number | null;
    action?: string;
    changeDescription: string;
  }) => {
    await sql`
      INSERT INTO audit_log (organization_id, user_id, action, change_description)
      VALUES (${opts.organizationId ?? ORG}, ${opts.userId ?? null},
              ${opts.action ?? 'UPDATE'}, ${opts.changeDescription})`;
  };

  const seedProduct = async (sku: string, organizationId = ORG): Promise<number> => {
    const rows = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, updated_at)
      VALUES (${organizationId}, ${`bc-${organizationId}-${sku}`}, ${sku}, ${sku}, 1, NOW())
      RETURNING id`;
    return Number(rows[0].id);
  };

  // inventory_items.location_id is NOT NULL — tests that don't care which area
  // get a shared default per org.
  const defaultAreaByOrg = new Map<string, number>();
  const defaultAreaId = async (organizationId: string): Promise<number> => {
    const existing = defaultAreaByOrg.get(organizationId);
    if (existing !== undefined) return existing;
    const id = await seedArea({ organizationId, name: `Default ${organizationId}` });
    defaultAreaByOrg.set(organizationId, id);
    return id;
  };

  /** `daysOut` may be negative, for already-expired stock. */
  const seedInventoryItem = async (opts: {
    organizationId?: string;
    productId: number;
    locationId?: number | null;
    status: string;
    daysOut: number;
  }) => {
    const organizationId = opts.organizationId ?? ORG;
    await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status, updated_at)
      VALUES (${organizationId}, ${opts.productId},
              ${opts.locationId ?? (await defaultAreaId(organizationId))},
              CURRENT_DATE + (${opts.daysOut} * INTERVAL '1 day'), ${opts.status}, NOW())`;
  };

  describe('findStoreAreaById', () => {
    it('returns the area with camelCase field names', async () => {
      const id = await seedArea({ name: 'Chiller', subDepartment: 'Refrigerated' });

      const area = await makeDb().findStoreAreaById(ORG, id);

      expect(area).toMatchObject({ id, name: 'Chiller', subDepartment: 'Refrigerated' });
      // The aliases are the contract with the frontend, so assert the keys
      // exist rather than only the two values above.
      expect(Object.keys(area ?? {})).toEqual(
        expect.arrayContaining([
          'parentId',
          'subDepartment',
          'lastChecked',
          'createdAt',
          'updatedAt',
        ]),
      );
    });

    it('returns null for an id belonging to another organization', async () => {
      // `store_areas.id` is a single global SERIAL, so this id exists and is
      // readable -- dropping the organization predicate really does return
      // another tenant's row. That is what makes this assertion able to fail,
      // unlike a two-tenant test on a table where each tenant holds its own id.
      const foreignId = await seedArea({ organizationId: OTHER_ORG, name: 'Their Area' });

      expect(await makeDb().findStoreAreaById(ORG, foreignId)).toBeNull();
      // And it is genuinely present for its owner.
      expect(await makeDb().findStoreAreaById(OTHER_ORG, foreignId)).toMatchObject({
        name: 'Their Area',
      });
    });

    it('returns null for an id that does not exist', async () => {
      expect(await makeDb().findStoreAreaById(ORG, 999999)).toBeNull();
    });
  });

  describe('getUsageReport', () => {
    it('groups activity by role and counts creations, updates and deletions', async () => {
      const admin = await seedUser('admin');
      const member = await seedUser('team_member');

      await seedAuditRow({ userId: admin, changeDescription: 'inventory item created' });
      await seedAuditRow({ userId: admin, changeDescription: 'inventory item updated' });
      await seedAuditRow({ userId: member, changeDescription: 'inventory item deleted' });
      await seedAuditRow({ userId: member, changeDescription: 'inventory item created' });

      const report = await makeDb().getUsageReport(ORG);

      expect(report).toEqual([
        { role: 'admin', totalActivities: 2, creations: 1, updates: 1, deletions: 0 },
        { role: 'team_member', totalActivities: 2, creations: 1, updates: 0, deletions: 1 },
      ]);
    });

    it('counts the exact descriptions the two audit writers produce', async () => {
      const admin = await seedUser('admin');
      // Verbatim from the live writers, because the bucket predicates are
      // substring matches on prose and nothing else pins them to it:
      //   * the Worker's CTE writes these three (workers/src/database.ts:3052,
      //     :3108, :3147),
      //   * Express wrote the capitalized form
      //     (backend/src/services/inventory.service.ts:185) -- capitalized on
      //     the noun, so the lower-case verb still matches a case-sensitive
      //     LIKE, which is why this query does not need ILIKE.
      // Reword either writer and this test fails rather than the report
      // silently reporting zero.
      await seedAuditRow({ userId: admin, changeDescription: 'inventory item created' });
      await seedAuditRow({ userId: admin, changeDescription: 'inventory item updated' });
      await seedAuditRow({ userId: admin, changeDescription: 'inventory item deleted' });
      await seedAuditRow({
        userId: admin,
        changeDescription: 'Inventory item created with expiry date 2026-10-01 and status Normal.',
      });

      const report = await makeDb().getUsageReport(ORG);

      expect(report[0]).toMatchObject({
        totalActivities: 4,
        creations: 2,
        updates: 1,
        deletions: 1,
      });
    });

    it('reports rows with no user as the Unknown role', async () => {
      await seedAuditRow({ userId: null, changeDescription: 'inventory item created' });

      expect(await makeDb().getUsageReport(ORG)).toEqual([
        { role: 'Unknown', totalActivities: 1, creations: 1, updates: 0, deletions: 0 },
      ]);
    });

    it('excludes another organization’s activity', async () => {
      const mine = await seedUser('admin');
      const theirs = await seedUser('admin', OTHER_ORG);
      await seedAuditRow({ userId: mine, changeDescription: 'inventory item created' });
      await seedAuditRow({
        organizationId: OTHER_ORG,
        userId: theirs,
        changeDescription: 'inventory item created',
      });
      await seedAuditRow({
        organizationId: OTHER_ORG,
        userId: theirs,
        changeDescription: 'inventory item deleted',
      });

      // Identity, not just a count: with the predicate dropped this same role
      // bucket would exist but carry 3 activities and a deletion.
      expect(await makeDb().getUsageReport(ORG)).toEqual([
        { role: 'admin', totalActivities: 1, creations: 1, updates: 0, deletions: 0 },
      ]);
    });

    it('returns an empty list when the organization has no audit rows', async () => {
      expect(await makeDb().getUsageReport(ORG)).toEqual([]);
    });
  });

  describe('getDashboardAnalytics', () => {
    it('counts products, inventory, expired, markdown and the 30-day expiry window', async () => {
      const area = await seedArea({ name: 'Shelf' });
      const p1 = await seedProduct('SKU-1');
      const p2 = await seedProduct('SKU-2');

      await seedInventoryItem({ productId: p1, locationId: area, status: 'Normal', daysOut: 10 });
      await seedInventoryItem({
        productId: p1,
        locationId: area,
        status: 'Markdown 2',
        daysOut: 20,
      });
      await seedInventoryItem({ productId: p2, locationId: area, status: 'Expired', daysOut: -5 });
      // Outside the 30-day window, and so counted as active but not upcoming.
      await seedInventoryItem({ productId: p2, locationId: area, status: 'Normal', daysOut: 200 });

      expect(await makeDb().getDashboardAnalytics(ORG)).toEqual({
        totalProducts: 2,
        totalInventoryItems: 4,
        // Express's definition: everything whose status is not the literal
        // 'Expired', so the Markdown 2 row counts here AND under markdownItems.
        activeItems: 3,
        expiredItems: 1,
        markdownItems: 1,
        upcomingExpiry: 2,
      });
    });

    it('excludes an item expiring exactly 31 days out and includes one at 30', async () => {
      const p = await seedProduct('SKU-EDGE');
      await seedInventoryItem({ productId: p, status: 'Normal', daysOut: 30 });
      await seedInventoryItem({ productId: p, status: 'Normal', daysOut: 31 });

      const analytics = await makeDb().getDashboardAnalytics(ORG);

      expect(analytics.upcomingExpiry).toBe(1);
      expect(analytics.totalInventoryItems).toBe(2);
    });

    it('does not count an expired item in the upcoming window even when its date is in range', async () => {
      // A row already marked Expired whose date has not passed: the status
      // predicate in the upcoming counter is the only thing excluding it.
      const p = await seedProduct('SKU-STATUS');
      await seedInventoryItem({ productId: p, status: 'Expired', daysOut: 5 });

      const analytics = await makeDb().getDashboardAnalytics(ORG);

      expect(analytics.upcomingExpiry).toBe(0);
      expect(analytics.expiredItems).toBe(1);
      expect(analytics.activeItems).toBe(0);
    });

    it('counts only the requested organization, for products and inventory alike', async () => {
      const mine = await seedProduct('SKU-MINE');
      const theirs = await seedProduct('SKU-THEIRS', OTHER_ORG);
      await seedInventoryItem({ productId: mine, status: 'Normal', daysOut: 5 });
      await seedInventoryItem({
        organizationId: OTHER_ORG,
        productId: theirs,
        status: 'Expired',
        daysOut: -1,
      });
      await seedInventoryItem({
        organizationId: OTHER_ORG,
        productId: theirs,
        status: 'Markdown 1',
        daysOut: 3,
      });

      // Two separate predicates carry this -- one in the products subquery, one
      // on the outer inventory scan -- so the expectations below are written to
      // move if either is removed.
      expect(await makeDb().getDashboardAnalytics(ORG)).toEqual({
        totalProducts: 1,
        totalInventoryItems: 1,
        activeItems: 1,
        expiredItems: 0,
        markdownItems: 0,
        upcomingExpiry: 1,
      });
    });

    it('returns zeros rather than nulls for an organization with no rows', async () => {
      expect(await makeDb().getDashboardAnalytics(ORG)).toEqual({
        totalProducts: 0,
        totalInventoryItems: 0,
        activeItems: 0,
        expiredItems: 0,
        markdownItems: 0,
        upcomingExpiry: 0,
      });
    });
  });
});
