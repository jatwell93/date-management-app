/**
 * Real-SQL integration tests for the queued catalogue import pipeline.
 *
 * Runs `processCatalogueImportJob` end-to-end against an in-memory Postgres (pglite),
 * so the set-based upsert classification (insert / update / unchanged / reject), the
 * projected-SKU quota CTE, identifier conflicts, and checkpoint resume are all verified
 * against the actual SQL rather than mocks.
 *
 * Node project only — see vitest.node.config.mts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { processCatalogueImportJob } from '../upload/catalogue-import';
import type { Env } from '../types/env';
import { createPgliteHarness, type PgliteHarness } from './pglite-db';

const ORG = 'org_test';

let harness: PgliteHarness;

beforeEach(async () => {
  harness = await createPgliteHarness();
});

afterEach(async () => {
  await harness.close();
});

function makeEnv(csv: string): { env: Env; puts: Map<string, string>; sent: number[] } {
  const puts = new Map<string, string>();
  const sent: number[] = [];
  const env = {
    CSV_UPLOADS: {
      get: async () => ({
        arrayBuffer: async () => new TextEncoder().encode(csv).buffer,
      }),
      put: async (key: string, value: string) => {
        puts.set(key, typeof value === 'string' ? value : '');
      },
      delete: async () => undefined,
    },
    CATALOGUE_IMPORT_QUEUE: {
      send: async (msg: { uploadId: number }) => {
        sent.push(msg.uploadId);
      },
    },
  } as unknown as Env;
  return { env, puts, sent };
}

type SeedProductInput = {
  org: string;
  sku: string;
  barcode: string;
  name: string;
  cost: number;
};

async function seedProduct({ org, sku, barcode, name, cost }: SeedProductInput): Promise<void> {
  await harness.pg.query(
    `INSERT INTO products (organization_id, sku, barcode, name, cost_price)
     VALUES ($1, $2, $3, $4, $5)`,
    [org, sku, barcode, name, cost],
  );
}

async function insertUpload(overrides: Record<string, unknown> = {}): Promise<number> {
  const row = {
    status: 'queued',
    processing_offset: 0,
    max_skus_snapshot: 50000,
    file_key: 'uploads/user-1/catalogue.csv',
    ...overrides,
  };
  const result = await harness.pg.query(
    `INSERT INTO uploads (organization_id, file_key, import_type, status, processing_offset, max_skus_snapshot)
     VALUES ($1, $2, 'product-catalog', $3, $4, $5) RETURNING id`,
    [ORG, row.file_key, row.status, row.processing_offset, row.max_skus_snapshot],
  );
  return Number((result.rows[0] as { id: number }).id);
}

async function getUpload(id: number): Promise<Record<string, unknown>> {
  const result = await harness.pg.query(`SELECT * FROM uploads WHERE id = $1`, [id]);
  return result.rows[0] as Record<string, unknown>;
}

async function getProduct(org: string, sku: string): Promise<Record<string, unknown> | undefined> {
  const result = await harness.pg.query(
    `SELECT * FROM products WHERE organization_id = $1 AND sku = $2`,
    [org, sku],
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}

async function countProducts(org: string): Promise<number> {
  const result = await harness.pg.query(
    `SELECT COUNT(*)::int AS c FROM products WHERE organization_id = $1`,
    [org],
  );
  return Number((result.rows[0] as { c: number }).c);
}

describe('processCatalogueImportJob (real SQL via pglite)', () => {
  it('classifies insert / update / unchanged / conflict and writes an error report', async () => {
    await seedProduct({ org: ORG, sku: 'S1', barcode: 'B1', name: 'Old Name', cost: 1.0 });
    await seedProduct({ org: ORG, sku: 'S2', barcode: 'B2', name: 'Keep', cost: 2.0 });
    await seedProduct({ org: ORG, sku: 'S3', barcode: 'B3', name: 'Three', cost: 3.0 });
    await seedProduct({ org: ORG, sku: 'S4', barcode: 'B4', name: 'Four', cost: 4.0 });

    const beforeUnchanged = await getProduct(ORG, 'S2');

    const csv = [
      'SKU,Name,Barcode,Cost',
      'S1,New Name,B1,1.00', // update
      'S2,Keep,B2,2.00', // unchanged
      'S3,Three,B4,3.00', // conflict: sku->S3, barcode->S4
      'S5,Five,B5,5.00', // insert
      '',
    ].join('\n');

    const { env, puts } = makeEnv(csv);
    const uploadId = await insertUpload();

    await processCatalogueImportJob(uploadId, env, harness.db);

    const upload = await getUpload(uploadId);
    expect(upload.status).toBe('completed_with_errors');
    expect(upload.rows_total).toBe(4);
    expect(upload.rows_imported).toBe(1);
    expect(upload.rows_updated).toBe(1);
    expect(upload.rows_unchanged).toBe(1);
    expect(upload.rows_skipped).toBe(1);
    expect(upload.row_error_count).toBe(1);
    expect(upload.upload_progress).toBe(100);
    expect(upload.error_report_key).toBe(`upload-errors/${uploadId}.json`);

    // Error report persisted to R2 with the conflict row.
    const report = JSON.parse(puts.get(`upload-errors/${uploadId}.json`) ?? '[]');
    expect(report.join(' ')).toMatch(/different existing products/);

    // Update applied.
    expect((await getProduct(ORG, 'S1'))?.name).toBe('New Name');
    // Insert applied.
    expect(await getProduct(ORG, 'S5')).toBeDefined();
    // Unchanged row produced no write (updated_at untouched).
    const afterUnchanged = await getProduct(ORG, 'S2');
    expect(afterUnchanged?.updated_at).toEqual(beforeUnchanged?.updated_at);
    // Conflict row left both existing products untouched.
    expect((await getProduct(ORG, 'S3'))?.barcode).toBe('B3');
    expect((await getProduct(ORG, 'S4'))?.name).toBe('Four');
  });

  it('rejects rows that resolve to the same existing product (shared-target conflict)', async () => {
    await seedProduct({ org: ORG, sku: 'S1', barcode: 'B1', name: 'One', cost: 1.0 });

    // Both rows resolve to product S1/B1 (one by sku, one by barcode) -> both rejected,
    // preventing a nondeterministic double-update of the same row.
    const csv = ['SKU,Name,Barcode,Cost', 'S1,A,B9,1.00', 'S9,B,B1,1.00', ''].join('\n');
    const { env } = makeEnv(csv);
    const uploadId = await insertUpload();

    await processCatalogueImportJob(uploadId, env, harness.db);

    const upload = await getUpload(uploadId);
    expect(upload.rows_skipped).toBe(2);
    expect(upload.rows_updated).toBe(0);
    expect(upload.rows_imported).toBe(0);
    // The original product is untouched.
    expect((await getProduct(ORG, 'S1'))?.name).toBe('One');
  });

  it('keeps processed rows bounded when validation and processing conflicts coexist', async () => {
    await seedProduct({
      org: ORG,
      sku: 'CONFLICT-SKU',
      barcode: 'FIRST-BARCODE',
      name: 'First',
      cost: 1.0,
    });
    await seedProduct({
      org: ORG,
      sku: 'SECOND-SKU',
      barcode: 'CONFLICT-BARCODE',
      name: 'Second',
      cost: 1.0,
    });
    const validRows = Array.from({ length: 1001 }, (_, index) =>
      index === 0
        ? 'CONFLICT-SKU,Conflict,CONFLICT-BARCODE,2.00'
        : `S${index},Product ${index},B${index},1.00`,
    );
    const csv = [
      'SKU,Name,Barcode,Cost',
      ...validRows,
      'MALFORMED,,,',
      '',
    ].join('\n');
    const { env } = makeEnv(csv);
    const uploadId = await insertUpload();

    await processCatalogueImportJob(uploadId, env, harness.db);

    const upload = await getUpload(uploadId);
    expect(Number(upload.rows_processed)).toBeLessThanOrEqual(Number(upload.rows_total));
    expect(upload.rows_processed).toBe(upload.rows_total);
  });

  it('fails on quota breach with no partial product writes', async () => {
    await seedProduct({ org: ORG, sku: 'S1', barcode: 'B1', name: 'One', cost: 1.0 });
    await seedProduct({ org: ORG, sku: 'S2', barcode: 'B2', name: 'Two', cost: 2.0 });

    const csv = ['SKU,Name,Barcode,Cost', 'S3,Three,B3,3.00', 'S4,Four,B4,4.00', ''].join('\n');
    const { env } = makeEnv(csv);
    const uploadId = await insertUpload({ max_skus_snapshot: 2 });

    await processCatalogueImportJob(uploadId, env, harness.db);

    const upload = await getUpload(uploadId);
    expect(upload.status).toBe('failed');
    expect(upload.failure_category).toBe('quota');
    // Nothing inserted; catalogue unchanged.
    expect(await countProducts(ORG)).toBe(2);
    expect(await getProduct(ORG, 'S3')).toBeUndefined();
  });

  it('resumes from a persisted offset and skips the quota recheck', async () => {
    // 3 valid rows; resume at offset 2 means only the third row is processed this run.
    const csv = [
      'SKU,Name,Barcode,Cost',
      'S1,One,B1,1.00',
      'S2,Two,B2,2.00',
      'S3,Three,B3,3.00',
      '',
    ].join('\n');
    const { env } = makeEnv(csv);
    // max_skus_snapshot=1 would fail the quota if it were rechecked on resume.
    const uploadId = await insertUpload({
      status: 'processing',
      processing_offset: 2,
      max_skus_snapshot: 1,
    });

    await processCatalogueImportJob(uploadId, env, harness.db);

    const upload = await getUpload(uploadId);
    expect(upload.status).toBe('completed');
    expect(upload.failure_category).toBeNull();
    // Only the row at offset 2 was imported; earlier rows were treated as already done.
    expect(await getProduct(ORG, 'S3')).toBeDefined();
    expect(await getProduct(ORG, 'S1')).toBeUndefined();
    expect(await getProduct(ORG, 'S2')).toBeUndefined();
  });

  it('re-importing identical rows performs no product writes', async () => {
    await seedProduct({ org: ORG, sku: 'S1', barcode: 'B1', name: 'One', cost: 1.0 });
    await seedProduct({ org: ORG, sku: 'S2', barcode: 'B2', name: 'Two', cost: 2.0 });
    const before1 = await getProduct(ORG, 'S1');
    const before2 = await getProduct(ORG, 'S2');

    const csv = ['SKU,Name,Barcode,Cost', 'S1,One,B1,1.00', 'S2,Two,B2,2.00', ''].join('\n');
    const { env } = makeEnv(csv);
    const uploadId = await insertUpload();

    await processCatalogueImportJob(uploadId, env, harness.db);

    const upload = await getUpload(uploadId);
    expect(upload.status).toBe('completed');
    expect(upload.rows_unchanged).toBe(2);
    expect(upload.rows_updated).toBe(0);
    expect((await getProduct(ORG, 'S1'))?.updated_at).toEqual(before1?.updated_at);
    expect((await getProduct(ORG, 'S2'))?.updated_at).toEqual(before2?.updated_at);
  });
});
