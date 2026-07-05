/**
 * Real-data (pglite) coverage for the dashboard stats + activity queries that
 * back GET /api/dashboard: getDashboardStats (0-30d expiring window and the
 * expired-worklist line-item count), getLastCatalogueUpload,
 * getExpiredItemsEnteredToday, and getStockLossLast30Days.
 *
 * Runs under `vitest.node.config.mts` (`*.node.test.ts`, `npm run test:db`)
 * because pglite is WASM and needs a Node runtime.
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

function makeDb() {
  return createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
}

describe('Workers dashboard stats + activity (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await sql`DELETE FROM inventory_items`;
    await sql`DELETE FROM products`;
    await sql`DELETE FROM store_areas`;
    await sql`DELETE FROM uploads`;
    await sql`DELETE FROM expired_item_transactions`;
    // Two org-a products + one org-b product; one store area per org.
    await sql`INSERT INTO products (id, organization_id, barcode, sku, name, cost_price)
              VALUES (1, ${ORG}, 'B1', 'S1', 'Prod 1', 10),
                     (2, ${ORG}, 'B2', 'S2', 'Prod 2', 20),
                     (3, ${OTHER_ORG}, 'B3', 'S3', 'Prod 3', 30)`;
    await sql`INSERT INTO store_areas (id, organization_id, name)
              VALUES (1, ${ORG}, 'Aisle 1'), (2, ${OTHER_ORG}, 'Aisle B')`;
  });

  const seedItem = (opts: {
    org?: string;
    productId?: number;
    locationId?: number;
    offsetDays: number;
    status?: string;
    createdOffsetDays?: number;
  }) =>
    sql`INSERT INTO inventory_items
          (organization_id, product_id, location_id, expiry_date, status, created_at)
        VALUES (
          ${opts.org ?? ORG},
          ${opts.productId ?? 1},
          ${opts.locationId ?? 1},
          (CURRENT_DATE + ${opts.offsetDays} * INTERVAL '1 day')::date,
          ${opts.status ?? 'Active'},
          (NOW() + ${opts.createdOffsetDays ?? 0} * INTERVAL '1 day')
        )`;

  describe('getDashboardStats', () => {
    it('counts near-expiry (0-30d) items and expired worklist line items', async () => {
      // Expiring soon (0-30 days, not yet expired): today, +5, +20, +30 boundary.
      await seedItem({ offsetDays: 0 });
      await seedItem({ offsetDays: 5 });
      await seedItem({ offsetDays: 20 });
      await seedItem({ offsetDays: 30 });
      // Outside the 0-30 window — must not count as expiring soon.
      await seedItem({ offsetDays: 31 });
      await seedItem({ offsetDays: -10, status: 'Expired' });

      // Expired worklist: two past-expiry rows on product 1 (same product/loc/cost)
      // collapse to one line; a Markdown 3 future row on product 2 is a second line;
      // a Sold Through row is dispositioned and excluded.
      await seedItem({ offsetDays: -10, productId: 1, status: 'Expired' });
      await seedItem({ offsetDays: -5, productId: 1, status: 'Expired' });
      await seedItem({ offsetDays: 40, productId: 2, status: 'Markdown 3' });
      await seedItem({ offsetDays: -3, productId: 1, status: 'Sold Through' });

      const stats = await makeDb().getDashboardStats(ORG);

      expect(stats.totalProducts).toBe(2);
      expect(stats.expiringItems).toBe(4);
      // product-1 expired pool (1) + product-2 markdown pool (1) = 2 worklist lines.
      expect(stats.expiredActionItems).toBe(2);
    });

    it('scopes counts to the requested organization', async () => {
      await seedItem({ offsetDays: 5 });
      await seedItem({ org: OTHER_ORG, productId: 3, locationId: 2, offsetDays: 5 });
      await seedItem({
        org: OTHER_ORG,
        productId: 3,
        locationId: 2,
        offsetDays: -5,
        status: 'Expired',
      });

      const stats = await makeDb().getDashboardStats(ORG);

      expect(stats.expiringItems).toBe(1);
      expect(stats.expiredActionItems).toBe(0);
    });
  });

  describe('getExpiredItemsEnteredToday', () => {
    it('counts items that became actionable today (via expiry or entry)', async () => {
      // Crossed into expiry today: expired yesterday, created long ago.
      await seedItem({ offsetDays: -1, status: 'Expired', createdOffsetDays: -10 });
      // Entered today already expired.
      await seedItem({ offsetDays: -10, status: 'Expired', createdOffsetDays: 0 });
      // Became actionable days ago (created before it crossed) — excluded.
      await seedItem({ offsetDays: -10, status: 'Expired', createdOffsetDays: -5 });
      // Not yet expired — excluded even though created today.
      await seedItem({ offsetDays: 40, status: 'Markdown 3', createdOffsetDays: 0 });
      // Dispositioned — excluded.
      await seedItem({ offsetDays: -1, status: 'Sold Through', createdOffsetDays: 0 });

      const count = await makeDb().getExpiredItemsEnteredToday(ORG);

      expect(count).toBe(2);
    });
  });

  describe('getStockLossLast30Days', () => {
    const seedTxn = (opts: {
      org?: string;
      action: string;
      loss: number;
      txnOffsetDays: number;
    }) =>
      sql`INSERT INTO expired_item_transactions
            (organization_id, inventory_item_id, action, financial_loss, transaction_date)
          VALUES (
            ${opts.org ?? ORG}, 1, ${opts.action}, ${opts.loss},
            (NOW() + ${opts.txnOffsetDays} * INTERVAL '1 day')
          )`;

    it('sums expired write-off losses within the last 30 days for the org', async () => {
      await seedTxn({ action: 'expired', loss: 100, txnOffsetDays: 0 });
      await seedTxn({ action: 'expired', loss: 50, txnOffsetDays: -10 });
      await seedTxn({ action: 'expired', loss: 25, txnOffsetDays: -40 }); // too old
      await seedTxn({ action: 'sold_through', loss: 999, txnOffsetDays: 0 }); // wrong action
      await seedTxn({ org: OTHER_ORG, action: 'expired', loss: 500, txnOffsetDays: 0 }); // other org

      const loss = await makeDb().getStockLossLast30Days(ORG);

      expect(loss).toBe(150);
    });

    it('returns 0 when there are no losses', async () => {
      const loss = await makeDb().getStockLossLast30Days(ORG);
      expect(loss).toBe(0);
    });
  });

  describe('getLastCatalogueUpload', () => {
    const seedUpload = (opts: {
      org?: string;
      fileName: string;
      status: string;
      completedOffsetDays?: number | null;
      createdOffsetDays?: number;
    }) =>
      sql`INSERT INTO uploads
            (organization_id, file_name, status, completed_at, created_at)
          VALUES (
            ${opts.org ?? ORG}, ${opts.fileName}, ${opts.status},
            CASE WHEN ${opts.completedOffsetDays ?? null}::int IS NULL THEN NULL
                 ELSE NOW() + (${opts.completedOffsetDays ?? null}::int) * INTERVAL '1 day' END,
            NOW() + (${opts.createdOffsetDays ?? 0}) * INTERVAL '1 day'
          )`;

    it('returns the most recently completed upload', async () => {
      await seedUpload({ fileName: 'old.csv', status: 'completed', completedOffsetDays: -6 });
      await seedUpload({ fileName: 'new.csv', status: 'completed', completedOffsetDays: -1 });
      // A still-processing upload is newer but has not refreshed the catalogue.
      await seedUpload({
        fileName: 'pending.csv',
        status: 'processing',
        completedOffsetDays: null,
        createdOffsetDays: 0,
      });

      const upload = await makeDb().getLastCatalogueUpload(ORG);

      expect(upload?.fileName).toBe('new.csv');
      expect(upload?.uploadedAt).toBeTruthy();
    });

    it('ignores other organizations and returns null when none completed', async () => {
      await seedUpload({
        org: OTHER_ORG,
        fileName: 'other.csv',
        status: 'completed',
        completedOffsetDays: 0,
      });
      await seedUpload({ fileName: 'mine.csv', status: 'failed', completedOffsetDays: -1 });

      const upload = await makeDb().getLastCatalogueUpload(ORG);

      expect(upload).toBeNull();
    });
  });
});
