/**
 * Real-SQL integration tests for the expiry-list import path (#251).
 *
 * Runs `processExpiryListUpload` end-to-end against an in-memory Postgres (pglite),
 * verifying on-the-fly product creation, store-area get-or-create, inventory inserts,
 * within-file dedupe, and same-day merge against existing inventory — the behaviour that
 * was previously missing on the production worker and caused expiry uploads to fail with
 * "Missing required column header(s): barcode, cost".
 *
 * Node project only — see vitest.node.config.mts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { processExpiryListUpload } from '../upload/expiry-import';
import { createPgliteHarness, type PgliteHarness } from './pglite-db';

const ORG = 'org_test';

let harness: PgliteHarness;

beforeEach(async () => {
  harness = await createPgliteHarness();
});

afterEach(async () => {
  await harness.close();
});

function toBuffer(csv: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(csv);
  return encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer;
}

async function countRows(table: string): Promise<number> {
  const rows = await harness.pg.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
  return (rows.rows[0] as { count: number }).count;
}

describe('processExpiryListUpload', () => {
  it('auto-creates products, a store area, and inventory rows for a fresh file', async () => {
    const csv =
      'SKU,Item Description,Used-By Date,Department\n' +
      '1001,Vitamin C 500mg,12/12/26,Vitamins\n' +
      '1002,Moisturiser 200ml,12/2026,Skincare\n';

    const summary = await processExpiryListUpload(toBuffer(csv), ORG, harness.db);

    expect(summary.importedCount).toBe(2);
    expect(summary.updatedCount).toBe(0);
    expect(summary.skippedCount).toBe(0);
    expect(summary.errorCount).toBe(0);
    expect(summary.rowsTotal).toBe(2);

    expect(await countRows('products')).toBe(2);
    expect(await countRows('inventory_items')).toBe(2);

    const product = await harness.pg.query(
      `SELECT sku, name, barcode, cost_price FROM products WHERE sku = '1001'`,
    );
    expect(product.rows[0]).toMatchObject({
      sku: '1001',
      name: 'Vitamin C 500mg',
      barcode: 'EXP-IMPORT-1001',
      cost_price: 0,
    });

    const areas = await harness.pg.query(`SELECT name FROM store_areas ORDER BY name`);
    expect(areas.rows.map((r) => (r as { name: string }).name)).toEqual(['Skincare', 'Vitamins']);

    const inventory = await harness.pg.query(
      `SELECT to_char(expiry_date, 'YYYY-MM-DD') AS d FROM inventory_items
       JOIN products ON products.id = inventory_items.product_id
       WHERE products.sku = '1001'`,
    );
    expect((inventory.rows[0] as { d: string }).d).toBe('2026-12-12');
  });

  it('defaults a missing department to Unallocated', async () => {
    const csv = 'SKU,Used-By Date\n1001,12/12/26\n';

    await processExpiryListUpload(toBuffer(csv), ORG, harness.db);

    const areas = await harness.pg.query(`SELECT name FROM store_areas`);
    expect(areas.rows.map((r) => (r as { name: string }).name)).toEqual(['Unallocated']);
  });

  it('merges duplicate SKU+date rows within the same file (first wins)', async () => {
    const csv =
      'SKU,Used-By Date,Department\n' + '1001,12/12/26,Vitamins\n' + '1001,12/12/26,Skincare\n';

    const summary = await processExpiryListUpload(toBuffer(csv), ORG, harness.db);

    expect(summary.importedCount).toBe(1);
    expect(summary.updatedCount).toBe(1);
    expect(await countRows('inventory_items')).toBe(1);
  });

  it('merges against inventory that already exists for the same product and day', async () => {
    const csv = 'SKU,Used-By Date\n1001,12/12/26\n';

    const first = await processExpiryListUpload(toBuffer(csv), ORG, harness.db);
    expect(first.importedCount).toBe(1);

    const second = await processExpiryListUpload(toBuffer(csv), ORG, harness.db);
    expect(second.importedCount).toBe(0);
    expect(second.updatedCount).toBe(1);

    expect(await countRows('inventory_items')).toBe(1);
    expect(await countRows('products')).toBe(1);
  });

  it('reuses an existing product instead of creating a duplicate', async () => {
    await harness.pg.query(
      `INSERT INTO products (organization_id, sku, barcode, name, cost_price)
       VALUES ($1, '1001', '9312345678900', 'Existing Vitamin C', 4.5)`,
      [ORG],
    );

    const csv = 'SKU,Item Description,Used-By Date\n1001,Ignored Name,12/12/26\n';
    const summary = await processExpiryListUpload(toBuffer(csv), ORG, harness.db);

    expect(summary.importedCount).toBe(1);
    expect(await countRows('products')).toBe(1);

    const product = await harness.pg.query(`SELECT name FROM products WHERE sku = '1001'`);
    expect((product.rows[0] as { name: string }).name).toBe('Existing Vitamin C');
  });

  it('does not reject an expiry file for missing barcode/cost columns (regression #251)', async () => {
    const csv = 'SKU,Used-By Date\n1001,12/12/26\n';

    const summary = await processExpiryListUpload(toBuffer(csv), ORG, harness.db);

    expect(summary.errors).toEqual([]);
    expect(summary.importedCount).toBe(1);
  });
});

describe('expiry import stores escaped spreadsheet formulas (#473)', () => {
  // The expiry path auto-creates products and store areas from the file's own
  // text, so an unescaped formula lands in `products.name` and `store_areas.name`
  // just as surely as it would through the catalogue import.
  it('escapes sku, item description, and department in the rows it creates', async () => {
    const csv =
      'SKU,Item Description,Used-By Date,Department\n' +
      '=SKU_FORMULA,+NAME_FORMULA,12/12/26,@DEPT_FORMULA\n';

    const summary = await processExpiryListUpload(toBuffer(csv), ORG, harness.db);

    expect(summary.errorCount).toBe(0);
    expect(summary.importedCount).toBe(1);

    const products = await harness.pg.query(`SELECT sku, name FROM products`);
    expect(products.rows[0]).toMatchObject({
      sku: "'=SKU_FORMULA",
      name: "'+NAME_FORMULA",
    });

    const areas = await harness.pg.query(`SELECT name FROM store_areas`);
    expect(areas.rows.map((r) => (r as { name: string }).name)).toEqual(["'@DEPT_FORMULA"]);
  });
});
