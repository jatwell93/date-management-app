import type { ValidatedCatalogueRow } from './catalogue-parser';
import * as Sentry from '@sentry/cloudflare';
import type { Database } from '../database';
import type { Env } from '../types/env';
import { parseCsvRecords } from './csv-parser';
import { validateCatalogueRecords } from './catalogue-parser';

const DEFAULT_IMPORT_BATCH_SIZE = 1000;
const MAX_IMPORT_BATCH_BYTES = 2 * 1024 * 1024;
const MAX_ROWS_PER_CHECKPOINT = 10000;

export function isCatalogueWithinLimit(projectedSkuCount: number, maxSkus: number): boolean {
  return projectedSkuCount <= maxSkus;
}

export function takeImportBatch(
  rows: ValidatedCatalogueRow[],
  offset: number,
  end: number,
): ValidatedCatalogueRow[] {
  let size = Math.min(DEFAULT_IMPORT_BATCH_SIZE, end - offset);
  while (size > 1) {
    const candidate = rows.slice(offset, offset + size);
    if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength < MAX_IMPORT_BATCH_BYTES) {
      return candidate;
    }
    size = Math.max(1, Math.floor(size / 2));
  }
  return rows.slice(offset, offset + 1);
}

type CatalogueImportJob = {
  id: number;
  organizationId: string;
  fileKey: string;
  status: string;
  processingOffset: number;
  maxSkusSnapshot: number;
  importedCount: number;
  updatedCount: number;
  unchangedCount: number;
  skippedCount: number;
  errorCount: number;
};

export async function processCatalogueImportJob(
  uploadId: number,
  env: Env,
  db: Database,
): Promise<void> {
  const rows = await db.sql`
    SELECT id, organization_id as "organizationId", file_key as "fileKey", status,
           processing_offset as "processingOffset", max_skus_snapshot as "maxSkusSnapshot",
           rows_imported as "importedCount", rows_updated as "updatedCount",
           rows_unchanged as "unchangedCount", rows_skipped as "skippedCount",
           row_error_count as "errorCount"
    FROM uploads WHERE id = ${uploadId} LIMIT 1
  `;
  const job = rows[0] as CatalogueImportJob | undefined;
  if (!job || ['completed', 'completed_with_errors', 'failed'].includes(job.status)) return;

  const object = await env.CSV_UPLOADS.get(job.fileKey);
  if (!object) {
    await failCatalogueImport(
      db,
      uploadId,
      'source_missing',
      'Uploaded source file is unavailable',
    );
    return;
  }

  try {
    const records = parseCsvRecords(new TextDecoder().decode(await object.arrayBuffer()));
    await db.sql`
      UPDATE uploads SET status = 'validating', processing_message = 'Validating catalogue',
             validation_started_at = COALESCE(validation_started_at, NOW()), updated_at = NOW()
      WHERE id = ${uploadId}
    `;
    const validation = validateCatalogueRecords(records);
    const initialValidationErrorCount = validation.rowErrors.length;
    if (validation.fatalErrors.length > 0) {
      await completeCatalogueWithErrors(db, env, job, validation.fatalErrors, 'validation');
      return;
    }

    const startOffset = Number(job.processingOffset || 0);
    const identifierRows = validation.rows.map((row) => ({
      rowNumber: row.rowNumber,
      sku: row.sku,
      barcode: row.barcode,
    }));
    const serializedIdentifierRows = JSON.stringify(identifierRows);

    if (startOffset === 0) {
      const projectedRows = await db.sql`
        WITH input AS (
          SELECT DISTINCT sku, barcode
          FROM jsonb_to_recordset(${serializedIdentifierRows}::jsonb)
            AS x(sku text, barcode text)
        ), projected AS (
          SELECT p.sku
          FROM products p
          WHERE p.organization_id = ${job.organizationId}
            AND NOT EXISTS (
              SELECT 1 FROM input i WHERE i.sku = p.sku OR i.barcode = p.barcode
            )
          UNION
          SELECT sku FROM input
        )
        SELECT COUNT(*)::int AS count FROM projected
      `;
      const projectedCount = Number(projectedRows[0]?.count || 0);
      if (!isCatalogueWithinLimit(projectedCount, Number(job.maxSkusSnapshot))) {
        await failCatalogueImport(
          db,
          uploadId,
          'quota',
          `Catalogue would contain ${projectedCount} SKUs, exceeding the ${job.maxSkusSnapshot} SKU limit`,
        );
        return;
      }
    }

    await db.sql`
      UPDATE uploads SET status = 'processing', rows_total = ${validation.totalRows},
             rows_processed = CASE WHEN processing_offset = 0 THEN ${initialValidationErrorCount} ELSE rows_processed END,
             rows_skipped = CASE WHEN processing_offset = 0 THEN ${initialValidationErrorCount} ELSE rows_skipped END,
             row_error_count = CASE WHEN processing_offset = 0 THEN ${initialValidationErrorCount} ELSE row_error_count END,
             processing_message = 'Importing catalogue', processing_started_at = COALESCE(processing_started_at, NOW()),
             row_errors = ${JSON.stringify(validation.rowErrors.slice(0, 100))}, updated_at = NOW()
      WHERE id = ${uploadId}
    `;

    let offset = startOffset;
    const checkpointEnd = Math.min(validation.rows.length, offset + MAX_ROWS_PER_CHECKPOINT);
    while (offset < checkpointEnd) {
      const batchRows = takeImportBatch(validation.rows, offset, checkpointEnd);
      const nextOffset = offset + batchRows.length;
      const outcome = await upsertProductBatch(db, job.organizationId, batchRows, {
        uploadId,
        nextOffset,
        totalRows: validation.totalRows,
        validationErrorCount: initialValidationErrorCount,
      });
      offset = nextOffset;
      validation.rowErrors.push(...outcome.errors);
    }

    if (offset < validation.rows.length) {
      await env.CATALOGUE_IMPORT_QUEUE?.send({ uploadId });
      return;
    }

    const finalRows = await db.sql`
      SELECT rows_skipped as skipped, row_error_count as errors FROM uploads WHERE id = ${uploadId}
    `;
    const hasErrors = Number(finalRows[0]?.errors || 0) > 0;
    const conflictErrors = await findIdentifierConflictErrors(
      db,
      job.organizationId,
      serializedIdentifierRows,
    );
    const finalErrors = Array.from(new Set([...validation.rowErrors, ...conflictErrors]));
    const reportKey = finalErrors.length > 0 ? `upload-errors/${uploadId}.json` : null;
    if (reportKey) {
      await env.CSV_UPLOADS.put(reportKey, JSON.stringify(finalErrors), {
        httpMetadata: { contentType: 'application/json' },
      });
    }
    await db.sql`
      UPDATE uploads SET status = ${hasErrors ? 'completed_with_errors' : 'completed'},
             upload_progress = 100, processing_message = ${hasErrors ? 'Import completed with row errors' : 'Import completed'},
             row_errors = ${JSON.stringify(finalErrors.slice(0, 100))},
             error_report_key = ${reportKey}, completed_at = NOW(), updated_at = NOW()
      WHERE id = ${uploadId}
    `;
  } catch (error) {
    await db.sql`
      UPDATE uploads SET retry_count = retry_count + 1, failure_category = 'processing',
             error_message = 'Catalogue processing failed and will be retried', updated_at = NOW()
      WHERE id = ${uploadId}
    `;
    throw error;
  }
}

async function upsertProductBatch(
  db: Database,
  organizationId: string,
  rows: ValidatedCatalogueRow[],
  checkpoint: {
    uploadId: number;
    nextOffset: number;
    totalRows: number;
    validationErrorCount: number;
  },
): Promise<{
  importedCount: number;
  updatedCount: number;
  unchangedCount: number;
  rejectedCount: number;
  errors: string[];
}> {
  const result = await db.sql`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
        AS x("rowNumber" int, sku text, name text, barcode text, "costPrice" double precision, "retailPrice" double precision)
    ), matched AS (
      SELECT i.*, sku_match.id AS sku_id, barcode_match.id AS barcode_id
      FROM input i
      LEFT JOIN products sku_match ON sku_match.organization_id = ${organizationId} AND sku_match.sku = i.sku
      LEFT JOIN products barcode_match ON barcode_match.organization_id = ${organizationId} AND barcode_match.barcode = i.barcode
    ), classified_base AS (
      SELECT *,
             (sku_id IS NOT NULL AND barcode_id IS NOT NULL AND sku_id <> barcode_id) AS id_conflict,
             COALESCE(sku_id, barcode_id) AS product_id
      FROM matched
    ), classified AS (
      SELECT *,
             (
               id_conflict
               OR (
                 product_id IS NOT NULL
                 AND COUNT(*) FILTER (WHERE NOT id_conflict)
                       OVER (PARTITION BY product_id) > 1
               )
             ) AS conflict
      FROM classified_base
    ), updated AS (
      UPDATE products p SET sku = c.sku, barcode = c.barcode, name = c.name,
             cost_price = c."costPrice",
             -- Preserve existing retail when the upload has no retail value, so a
             -- cost-only re-upload cannot silently wipe retail data (#338).
             retail_price = COALESCE(c."retailPrice", p.retail_price), updated_at = NOW()
      FROM classified c
      WHERE NOT c.conflict AND c.product_id = p.id
        AND (p.sku IS DISTINCT FROM c.sku OR p.barcode IS DISTINCT FROM c.barcode
          OR p.name IS DISTINCT FROM c.name OR p.cost_price IS DISTINCT FROM c."costPrice"
          OR p.retail_price IS DISTINCT FROM COALESCE(c."retailPrice", p.retail_price))
      RETURNING p.id
    ), inserted AS (
      INSERT INTO products (organization_id, sku, barcode, name, cost_price, retail_price, notes, created_at, updated_at)
      SELECT ${organizationId}, c.sku, c.barcode, c.name, c."costPrice", c."retailPrice", '', NOW(), NOW()
      FROM classified c WHERE NOT c.conflict AND c.product_id IS NULL
      RETURNING id
    ), counts AS (
      SELECT (SELECT COUNT(*) FROM inserted)::int AS inserted,
             (SELECT COUNT(*) FROM updated)::int AS updated,
             (SELECT COUNT(*) FROM classified WHERE conflict)::int AS rejected,
             (SELECT COUNT(*) FROM classified)::int -
               (SELECT COUNT(*) FROM inserted) - (SELECT COUNT(*) FROM updated) -
               (SELECT COUNT(*) FROM classified WHERE conflict) AS unchanged,
             COALESCE((SELECT json_agg(json_build_object('rowNumber', "rowNumber",
               'reason', CASE WHEN id_conflict THEN 'identifier' ELSE 'shared_target' END))
               FROM classified WHERE conflict), '[]'::json) AS conflicts
    ), checkpoint AS (
      UPDATE uploads u
      SET processing_offset = ${checkpoint.nextOffset},
          rows_processed = ${checkpoint.nextOffset + checkpoint.validationErrorCount},
          rows_imported = u.rows_imported + counts.inserted,
          rows_updated = u.rows_updated + counts.updated,
          rows_unchanged = u.rows_unchanged + counts.unchanged,
          rows_skipped = u.rows_skipped + counts.rejected,
          row_error_count = u.row_error_count + counts.rejected,
          upload_progress = ${Math.floor(
    ((checkpoint.nextOffset + checkpoint.validationErrorCount) / checkpoint.totalRows) *
    100,
  )},
          processing_message = ${`Imported ${checkpoint.nextOffset} catalogue rows`},
          updated_at = NOW()
      FROM counts
      WHERE u.id = ${checkpoint.uploadId}
      RETURNING counts.inserted, counts.updated, counts.rejected, counts.unchanged, counts.conflicts
    )
    SELECT * FROM checkpoint
  `;
  const summary = result[0] || {};
  const conflicts = Array.isArray(summary.conflicts) ? summary.conflicts : [];
  return {
    importedCount: Number(summary.inserted || 0),
    updatedCount: Number(summary.updated || 0),
    unchangedCount: Number(summary.unchanged || 0),
    rejectedCount: Number(summary.rejected || 0),
    errors: conflicts.map((conflict: { rowNumber?: number; reason?: string }) =>
      conflict.reason === 'shared_target'
        ? `Row ${conflict.rowNumber || '?'}: multiple rows match the same existing product`
        : `Row ${conflict.rowNumber || '?'}: SKU and barcode identify different existing products`,
    ),
  };
}

async function findIdentifierConflictErrors(
  db: Database,
  organizationId: string,
  serializedIdentifierRows: string,
): Promise<string[]> {
  if (!serializedIdentifierRows || serializedIdentifierRows === '[]') return [];
  const result = await db.sql`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset(${serializedIdentifierRows}::jsonb)
        AS x("rowNumber" int, sku text, barcode text)
    )
    SELECT i."rowNumber" as "rowNumber"
    FROM input i
    JOIN products sku_match
      ON sku_match.organization_id = ${organizationId} AND sku_match.sku = i.sku
    JOIN products barcode_match
      ON barcode_match.organization_id = ${organizationId} AND barcode_match.barcode = i.barcode
    WHERE sku_match.id <> barcode_match.id
    ORDER BY i."rowNumber"
  `;
  return result.map(
    (row) => `Row ${Number(row.rowNumber)}: SKU and barcode identify different existing products`,
  );
}

export async function failCatalogueImport(
  db: Database,
  uploadId: number,
  category: string,
  message: string,
): Promise<void> {
  await db.sql`
    UPDATE uploads SET status = 'failed', failure_category = ${category}, error_message = ${message},
           processing_message = ${message}, failed_at = NOW(), updated_at = NOW()
    WHERE id = ${uploadId}
  `;
}

export async function enqueueCatalogueImport(
  env: Env,
  db: Database,
  uploadId: number,
): Promise<boolean> {
  try {
    await env.CATALOGUE_IMPORT_QUEUE?.send({ uploadId });
    await db.sql`
      UPDATE uploads
      SET status = 'queued', processing_message = 'Queued for validation', queued_at = NOW(), updated_at = NOW()
      WHERE id = ${uploadId}
    `;
    return true;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { feature: 'catalogue-import', action: 'enqueue' },
      extra: { uploadId },
    });
    try {
      await failCatalogueImport(
        db,
        uploadId,
        'enqueue',
        'Catalogue import could not be queued',
      );
    } catch (failureUpdateError) {
      Sentry.captureException(failureUpdateError, {
        tags: { feature: 'catalogue-import', action: 'enqueue-fail-update' },
        extra: { uploadId },
      });
    }
    return false;
  }
}

async function completeCatalogueWithErrors(
  db: Database,
  env: Env,
  job: CatalogueImportJob,
  errors: string[],
  category: string,
): Promise<void> {
  const reportKey = `upload-errors/${job.id}.json`;
  await env.CSV_UPLOADS.put(reportKey, JSON.stringify(errors), {
    httpMetadata: { contentType: 'application/json' },
  });
  await db.sql`
    UPDATE uploads SET status = 'failed', failure_category = ${category},
           error_message = ${errors[0]}, processing_message = ${errors[0]},
           row_error_count = ${errors.length}, row_errors = ${JSON.stringify(errors.slice(0, 100))},
           error_report_key = ${reportKey}, failed_at = NOW(), updated_at = NOW()
    WHERE id = ${job.id}
  `;
}
