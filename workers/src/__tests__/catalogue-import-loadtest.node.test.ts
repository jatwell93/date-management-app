/**
 * 50,000-row catalogue import load test (openspec task 4.4).
 *
 * Runs the full queued import pipeline (`processCatalogueImportJob` + checkpoint
 * requeue loop) against an in-memory Postgres (pglite) and records the metrics that
 * can be measured locally: wall-clock duration, peak memory, total DB statements,
 * batch-upsert statement count, and retry count.
 *
 * The headline claim — that batching turns ~50,000 per-row DB calls into ~50 set-based
 * statements — is asserted here. Worker CPU, Neon compute/latency, and R2 operation
 * counts cannot be measured in-process; capture those from the dev deployment telemetry
 * after enabling the queue there (see RESULTS note in the openspec change).
 *
 * Node project only — see vitest.node.config.mts. Skipped unless RUN_LOAD_TEST=true.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { processCatalogueImportJob } from '../index-minimal';
import type { Env } from '../types/env';
import { createPgliteHarness, type PgliteHarness } from './pglite-db';

const ORG = 'org_loadtest';
const ROW_COUNT = 50000;
const runLoadTest = process.env.RUN_LOAD_TEST === 'true';

let harness: PgliteHarness;

beforeEach(async () => {
  harness = await createPgliteHarness();
});

afterEach(async () => {
  await harness.close();
});

describe.skipIf(!runLoadTest)('50k-row catalogue import load test', () => {
  it(
    'imports 50,000 rows using set-based batches (~50 upserts, not ~50,000)',
    async () => {
      const lines = ['SKU,Name,Barcode,Cost'];
      for (let i = 0; i < ROW_COUNT; i++) {
        lines.push(`SKU-${i},Product ${i},BAR-${i},${(i % 100) + 0.99}`);
      }
      const csv = lines.join('\n') + '\n';

      // Count and categorize every SQL statement the pipeline issues.
      let totalStatements = 0;
      let batchUpserts = 0;
      const realSql = harness.db.sql;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (harness.db as any).sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
        totalStatements += 1;
        const q = strings.join('');
        if (q.includes('jsonb_to_recordset') && q.includes('INSERT INTO products')) {
          batchUpserts += 1;
        }
        return (realSql as (...a: unknown[]) => unknown)(strings, ...values);
      };

      const queued: number[] = [];
      const env = {
        CSV_UPLOADS: {
          get: async () => ({
            arrayBuffer: async () => new TextEncoder().encode(csv).buffer,
          }),
          put: async () => undefined,
          delete: async () => undefined,
        },
        CATALOGUE_IMPORT_QUEUE: {
          send: async (msg: { uploadId: number }) => {
            queued.push(msg.uploadId);
          },
        },
      } as unknown as Env;

      const insert = await harness.pg.query(
        `INSERT INTO uploads (organization_id, file_key, import_type, status, processing_offset, max_skus_snapshot)
         VALUES ($1, 'uploads/user-1/big.csv', 'product-catalog', 'queued', 0, 250000) RETURNING id`,
        [ORG],
      );
      const uploadId = Number((insert.rows[0] as { id: number }).id);

      const startMem = process.memoryUsage();
      const start = Date.now();

      // Drive the checkpoint requeue loop the queue would otherwise drive.
      let invocations = 0;
      // First delivery:
      await processCatalogueImportJob(uploadId, env, harness.db);
      invocations += 1;
      while (queued.length > 0) {
        queued.shift();
        await processCatalogueImportJob(uploadId, env, harness.db);
        invocations += 1;
      }

      const durationMs = Date.now() - start;
      const endMem = process.memoryUsage();

      const upload = (await harness.pg.query(`SELECT * FROM uploads WHERE id = $1`, [uploadId]))
        .rows[0] as Record<string, number | string>;
      const productCount = Number(
        (
          await harness.pg.query(
            `SELECT COUNT(*)::int AS c FROM products WHERE organization_id = $1`,
            [ORG],
          )
        ).rows[0]?.c,
      );

      // eslint-disable-next-line no-console
      console.log(
        '[loadtest] ' +
          JSON.stringify(
            {
              rows: ROW_COUNT,
              durationMs,
              invocations,
              batchUpserts,
              totalStatements,
              retryCount: Number(upload.retry_count),
              status: upload.status,
              productCount,
              heapUsedDeltaMB: +((endMem.heapUsed - startMem.heapUsed) / 1024 / 1024).toFixed(1),
              rssMB: +(endMem.rss / 1024 / 1024).toFixed(1),
            },
            null,
            2,
          ),
      );

      expect(upload.status).toBe('completed');
      expect(productCount).toBe(ROW_COUNT);
      expect(Number(upload.rows_imported)).toBe(ROW_COUNT);
      expect(Number(upload.retry_count)).toBe(0);
      // 50,000 rows / 1,000 per batch = 50 set-based upserts (not 50,000 per-row calls).
      expect(batchUpserts).toBe(50);
      // 50k rows / 10k checkpoint = 5 queue deliveries.
      expect(invocations).toBe(5);
      // Total statements stay ~2 orders of magnitude below the row count.
      expect(totalStatements).toBeLessThan(200);
    },
    120000,
  );
});
