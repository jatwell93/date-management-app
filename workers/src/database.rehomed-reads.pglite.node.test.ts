/**
 * Real-data (pglite) coverage for the read-only methods rehomed by task 3.1.r:
 * `findStoreAreaById` (`GET /api/store-areas/:id`) and `getUsageReport`
 * (`GET /api/reports/usage`).
 *
 * **Why real SQL rather than a stubbed `sql` tag.** These ARE queries: a
 * tenant-scoped `WHERE`, and a `LEFT JOIN` with `COALESCE` grouping and
 * `FILTER` counters. Against a stub, each assertion would describe a string
 * rather than the rows it selects.
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

  // Task 3.2 batch 6. Express tested these three through its report repository and routes.
  describe('getActiveExpiryEntries', () => {
    it('lists stock beyond 90 days, and leaves out past-expiry, dispositioned and foreign stock', async () => {
      const product = await seedProduct('SKU-A');
      const foreignProduct = await seedProduct('SKU-F', OTHER_ORG);
      await seedInventoryItem({ productId: product, status: 'Normal', daysOut: 400 });
      await seedInventoryItem({ productId: product, status: 'Normal', daysOut: 5 });
      await seedInventoryItem({ productId: product, status: 'Expired', daysOut: -3 });
      await seedInventoryItem({ productId: product, status: 'Sold Through', daysOut: 60 });
      await seedInventoryItem({ productId: product, status: 'Processed', daysOut: 61 });
      await seedInventoryItem({
        organizationId: OTHER_ORG,
        productId: foreignProduct,
        status: 'Normal',
        daysOut: 10,
      });

      const entries = await makeDb().getActiveExpiryEntries(ORG);

      expect(entries.map((entry) => entry.productId)).toEqual([product, product]);
      // Soonest first, and only the two live rows: 5 days out, then 400.
      expect(entries).toHaveLength(2);
      expect(entries[0].expiryDate < entries[1].expiryDate).toBe(true);
    });
  });

  describe('getItemsByUserReport', () => {
    const seedCreated = async (userId: number, daysAgo: number, organizationId = ORG) => {
      await sql`
        INSERT INTO audit_log (organization_id, user_id, action, change_description, created_at)
        VALUES (${organizationId}, ${userId}, 'CREATE', 'inventory item created',
                CURRENT_DATE - (${daysAgo} * INTERVAL '1 day'))`;
    };

    it('counts the items each user created, most first', async () => {
      const admin = await seedUser('admin');
      const member = await seedUser('team_member');
      await seedCreated(admin, 1);
      await seedCreated(member, 1);
      await seedCreated(member, 2);

      const report = await makeDb().getItemsByUserReport(ORG);

      expect(report).toEqual([
        { userId: member, userName: expect.any(String), itemCount: 2 },
        { userId: admin, userName: expect.any(String), itemCount: 1 },
      ]);
    });

    it('limits the count to the requested number of days', async () => {
      const admin = await seedUser('admin');
      await seedCreated(admin, 1);
      await seedCreated(admin, 40);

      expect((await makeDb().getItemsByUserReport(ORG, '30'))[0].itemCount).toBe(1);
      expect((await makeDb().getItemsByUserReport(ORG, 'all-time'))[0].itemCount).toBe(2);
    });

    it('treats an absent time frame as all time', async () => {
      const admin = await seedUser('admin');
      await seedCreated(admin, 1);
      await seedCreated(admin, 40);

      expect((await makeDb().getItemsByUserReport(ORG))[0].itemCount).toBe(2);
    });

    it('excludes another organization’s activity', async () => {
      const theirs = await seedUser('admin', OTHER_ORG);
      await seedCreated(theirs, 1, OTHER_ORG);

      expect(await makeDb().getItemsByUserReport(ORG)).toEqual([]);
    });
  });

  describe('getItemsByDateReport', () => {
    it('counts creations per day for the caller organization only', async () => {
      const admin = await seedUser('admin');
      const theirs = await seedUser('admin', OTHER_ORG);
      await sql`
        INSERT INTO audit_log (organization_id, user_id, action, change_description, created_at)
        VALUES (${ORG}, ${admin}, 'CREATE', 'inventory item created', CURRENT_DATE - INTERVAL '1 day'),
               (${ORG}, ${admin}, 'CREATE', 'inventory item created', CURRENT_DATE - INTERVAL '1 day'),
               (${ORG}, ${admin}, 'UPDATE', 'inventory item updated', CURRENT_DATE - INTERVAL '1 day'),
               (${OTHER_ORG}, ${theirs}, 'CREATE', 'inventory item created', CURRENT_DATE - INTERVAL '1 day')`;

      const report = await makeDb().getItemsByDateReport(ORG);

      expect(report).toHaveLength(1);
      expect(report[0].itemCount).toBe(2);
    });
  });
});
