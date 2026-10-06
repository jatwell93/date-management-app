/**
 * Real-SQL (pglite) coverage for the `markdown-recalculation` job (task 3.2, batch 5).
 *
 * The job relabels `inventory_items.status` from the days left to expiry in one SQL statement.
 * An item written through `POST /api/inventory-items`, an expiry edit or the expiry list import
 * gets its status from `calculateInventoryStatus` in TypeScript. The two are the same rule written
 * twice, so the first test runs both over every band edge and asserts they agree: if one moves
 * and the other does not, an item changes label the first time the job runs.
 *
 * Express tested this as "sync and async `calculateMarkdownStatus` return identical results"
 * (`inventory-markdown-consistency.test.ts`). The Worker has two implementations in two languages,
 * so the agreement is the property worth keeping.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../types/env';
import {
  createPgliteHarness,
  createTaggedSql,
  seedOrganization,
  type PgliteHarness,
} from '../../__tests__/pglite-db';
import { calculateInventoryStatus } from '../../inventory-status';
import { markdownRecalculationJob } from './markdown-recalculation';
import type { SqlClient } from '../schedule';

const ORG = 'org_markdown';
const OTHER_ORG = 'org_markdown_other';
// A tick at 00:00 UTC, the job's cadence. Expiry dates are whole days from it.
const AS_OF = new Date('2026-10-02T00:00:00.000Z');
const ENV = { NODE_ENV: 'test' } as unknown as Env;
const BAND_EDGES = [-1, 0, 1, 29, 30, 31, 59, 60, 61, 89, 90, 91, 400];

function dateAfter(days: number): string {
  return new Date(AS_OF.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

describe('markdown-recalculation job (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: SqlClient;
  let productId: number;
  let locationId: number;

  const run = () => markdownRecalculationJob.run({ env: ENV, sql, asOf: AS_OF });

  /** One item per call; a distinct day per item keeps the active-triple index happy. */
  const seed = async (org: string, days: number, status: string) => {
    const rows = await sql`
      INSERT INTO inventory_items
        (organization_id, product_id, location_id, expiry_date, status, updated_at)
      VALUES (${org}, ${productId}, ${locationId}, ${dateAfter(days)}, ${status}, NOW())
      RETURNING id`;
    return Number(rows[0].id);
  };

  const statusOf = async (id: number) =>
    String((await sql`SELECT status FROM inventory_items WHERE id = ${id}`)[0].status);

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    await seedOrganization(harness.pg, ORG);
    await seedOrganization(harness.pg, OTHER_ORG);
  }, 30000);

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await sql`DELETE FROM inventory_items`;
    await sql`DELETE FROM products`;
    await sql`DELETE FROM store_areas`;
    const product = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, updated_at)
      VALUES (${ORG}, ${'BAR-M'}, ${'SKU-M'}, ${'Milk'}, 5, NOW()) RETURNING id`;
    productId = Number(product[0].id);
    const area = await sql`
      INSERT INTO store_areas (organization_id, name, updated_at)
      VALUES (${ORG}, ${'Aisle 1'}, NOW()) RETURNING id`;
    locationId = Number(area[0].id);
  });

  it('labels every band edge exactly as calculateInventoryStatus does', async () => {
    const ids = new Map<number, number>();
    for (const days of BAND_EDGES) ids.set(days, await seed(ORG, days, 'Normal'));

    await run();

    for (const days of BAND_EDGES) {
      expect(await statusOf(ids.get(days)!), `${days} days to expiry`).toBe(
        calculateInventoryStatus(dateAfter(days), AS_OF),
      );
    }
  });

  it('relabels items from any live status, in every organization', async () => {
    const stale = await seed(ORG, 5, 'Markdown 1');
    const foreign = await seed(OTHER_ORG, -2, 'Normal');

    await run();

    expect(await statusOf(stale)).toBe('Markdown 3');
    expect(await statusOf(foreign)).toBe('Expired');
  });

  it('leaves a disposed item with the status it was disposed with', async () => {
    const processed = await seed(ORG, -5, 'Processed');
    const soldThrough = await seed(ORG, -6, 'Sold Through');

    await run();

    expect(await statusOf(processed)).toBe('Processed');
    expect(await statusOf(soldThrough)).toBe('Sold Through');
  });

  it('changes nothing on a second run the same day', async () => {
    await seed(ORG, 5, 'Normal');
    await seed(ORG, 45, 'Normal');

    const first = await run();
    const second = await run();

    expect(first.summary).toEqual({ updated: 2 });
    expect(second.summary).toEqual({ updated: 0 });
  });
});
