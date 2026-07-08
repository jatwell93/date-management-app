/**
 * Real-SQL regression tests for retail-price handling on the SYNCHRONOUS catalogue
 * upload path (`processProductCatalogUpload`), which processes rows directly rather
 * than via the queued/batched job. Guards issue #338: the sync path must resolve the
 * optional retail column and must never wipe an existing retail price when a re-upload
 * omits retail.
 *
 * Node project only — see vitest.node.config.mts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { processProductCatalogUpload } from '../upload/upload-handlers';
import { createPgliteHarness, type PgliteHarness } from './pglite-db';

const ORG = 'org_sync';

let harness: PgliteHarness;

beforeEach(async () => {
  harness = await createPgliteHarness();
});

afterEach(async () => {
  await harness.close();
});

function toArrayBuffer(csv: string): ArrayBuffer {
  // Build a fresh ArrayBuffer (TextEncoder().encode().buffer is ArrayBufferLike,
  // which may be a SharedArrayBuffer and is not assignable to ArrayBuffer).
  const bytes = new TextEncoder().encode(csv);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function seedProduct(
  sku: string,
  barcode: string,
  cost: number,
  retail: number | null,
): Promise<void> {
  await harness.pg.query(
    `INSERT INTO products (organization_id, sku, barcode, name, cost_price, retail_price)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ORG, sku, barcode, `Name ${sku}`, cost, retail],
  );
}

async function getProduct(sku: string): Promise<Record<string, unknown> | undefined> {
  const result = await harness.pg.query(
    `SELECT * FROM products WHERE organization_id = $1 AND sku = $2`,
    [ORG, sku],
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}

describe('processProductCatalogUpload retail handling (real SQL via pglite)', () => {
  it('captures retail on insert when a retail column is present', async () => {
    const csv = ['SKU,Name,Barcode,Cost,Retail Price', 'S1,Milk,B1,2.00,5.00', ''].join('\n');

    const summary = await processProductCatalogUpload(toArrayBuffer(csv), ORG, harness.db);

    expect(summary.importedCount).toBe(1);
    expect(Number((await getProduct('S1'))?.retail_price)).toBe(5);
  });

  it('updates retail when a retail column is present', async () => {
    await seedProduct('S1', 'B1', 2.0, 5.0);

    const csv = ['SKU,Name,Barcode,Cost,Retail Price', 'S1,Milk,B1,2.00,7.50', ''].join('\n');
    await processProductCatalogUpload(toArrayBuffer(csv), ORG, harness.db);

    expect(Number((await getProduct('S1'))?.retail_price)).toBe(7.5);
  });

  it('preserves an existing retail price when a cost-only re-upload omits retail', async () => {
    await seedProduct('S1', 'B1', 2.0, 5.0);

    // No retail column at all -> must NOT null out the existing retail price.
    const csv = ['SKU,Name,Barcode,Cost', 'S1,Milk,B1,3.00', ''].join('\n');
    await processProductCatalogUpload(toArrayBuffer(csv), ORG, harness.db);

    const product = await getProduct('S1');
    expect(Number(product?.cost_price)).toBe(3);
    expect(Number(product?.retail_price)).toBe(5); // retained
  });

  it('leaves retail null on insert when no retail column is present', async () => {
    const csv = ['SKU,Name,Barcode,Cost', 'S1,Milk,B1,2.00', ''].join('\n');
    await processProductCatalogUpload(toArrayBuffer(csv), ORG, harness.db);

    expect((await getProduct('S1'))?.retail_price).toBeNull();
  });
});
