import * as Sentry from '@sentry/cloudflare';
import type { Database } from '../database';
import { parseCsvRecords } from './csv-parser';
import { validateExpiryRecords, type ValidatedExpiryRow } from './expiry-parser';
import type { UploadProcessingSummary } from './upload-handlers';

const UNALLOCATED_DEPARTMENT_NAME = 'Unallocated';

function emptySummary(): UploadProcessingSummary {
  return {
    rowsProcessed: 0,
    rowsTotal: 0,
    importedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    errors: [],
  };
}

/**
 * Inventory status derived from days-to-expiry. Ported from the Express backend's
 * CSVParserService.calculateInventoryStatus so worker imports mirror it.
 */
export function calculateInventoryStatus(
  isoDate: string,
): 'Normal' | 'Markdown 1' | 'Markdown 2' | 'Markdown 3' | 'Expired' {
  const expiry = new Date(`${isoDate}T00:00:00.000Z`).getTime();
  const now = Date.now();
  const daysDiff = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

  if (daysDiff <= 0) return 'Expired';
  if (daysDiff <= 7) return 'Markdown 3';
  if (daysDiff <= 14) return 'Markdown 2';
  if (daysDiff <= 30) return 'Markdown 1';
  return 'Normal';
}

/**
 * Process an uploaded expiry list (SKU + Used-By Date, optional item description and
 * department). Missing products are created on the fly with a generated barcode and a
 * zero cost, matching the Express backend. Rows are merged (deduplicated) both within
 * the file and against any inventory item that already exists for the same product on
 * the same calendar day.
 *
 * All writes go through `db.sql` scoped by organization_id — the same style as the
 * catalogue product upsert in upload-handlers.ts — so this stays multi-tenant safe and
 * testable against the real SQL (pglite harness).
 */
export async function processExpiryListUpload(
  data: ArrayBuffer,
  organizationId: string,
  db: Database,
): Promise<UploadProcessingSummary> {
  const summary = emptySummary();
  const text = new TextDecoder().decode(data);
  const records = parseCsvRecords(text);

  const validation = validateExpiryRecords(records);
  if (validation.fatalErrors.length > 0) {
    summary.errors.push(...validation.fatalErrors);
    summary.errorCount = summary.errors.length;
    return summary;
  }

  summary.rowsTotal = validation.totalRows;
  // Rows rejected during header/date validation still count as skipped.
  summary.skippedCount += validation.rowErrors.length;
  summary.errors.push(...validation.rowErrors);

  // First-wins dedupe within the uploaded file; later duplicates count as merged.
  const seen = new Set<string>();
  const dedupedRows: ValidatedExpiryRow[] = [];
  for (const row of validation.rows) {
    const dedupeKey = `${row.sku.toLowerCase()}|${row.usedByDate}`;
    if (seen.has(dedupeKey)) {
      summary.updatedCount += 1;
      continue;
    }
    seen.add(dedupeKey);
    dedupedRows.push(row);
  }

  const productIdBySku = new Map<string, number>();
  const locationIdByName = new Map<string, number>();

  for (const row of dedupedRows) {
    try {
      const productId = await getOrCreateExpiryProduct(db, organizationId, row, productIdBySku);

      const existing = await db.sql`
        SELECT id FROM inventory_items
        WHERE organization_id = ${organizationId}
          AND product_id = ${productId}
          AND expiry_date::date = ${row.usedByDate}::date
        LIMIT 1
      `;
      if (existing[0]) {
        summary.updatedCount += 1;
        continue;
      }

      const departmentName = row.department ?? UNALLOCATED_DEPARTMENT_NAME;
      const locationId = await getOrCreateStoreArea(
        db,
        organizationId,
        departmentName,
        locationIdByName,
      );

      await db.sql`
        INSERT INTO inventory_items
          (organization_id, product_id, expiry_date, location_id, status, created_at, updated_at)
        VALUES
          (${organizationId}, ${productId}, ${row.usedByDate}, ${locationId},
           ${calculateInventoryStatus(row.usedByDate)}, NOW(), NOW())
      `;
      summary.importedCount += 1;
    } catch (error) {
      Sentry.captureException(error, {
        tags: { feature: 'worker-upload', action: 'expiry-import-row' },
        extra: { rowNumber: row.rowNumber },
      });
      summary.skippedCount += 1;
      summary.errors.push(`Row ${row.rowNumber}: Expiry import failed`);
    }
  }

  summary.rowsProcessed = summary.importedCount + summary.updatedCount + summary.skippedCount;
  summary.errorCount = summary.errors.length;
  return summary;
}

async function getOrCreateExpiryProduct(
  db: Database,
  organizationId: string,
  row: ValidatedExpiryRow,
  cache: Map<string, number>,
): Promise<number> {
  const cacheKey = row.sku.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const existing = await db.sql`
    SELECT id FROM products
    WHERE organization_id = ${organizationId} AND sku = ${row.sku}
    LIMIT 1
  `;
  if (existing[0]) {
    const id = Number(existing[0].id);
    cache.set(cacheKey, id);
    return id;
  }

  const barcode = await createUniqueImportBarcode(db, organizationId, row.sku);
  const name = row.itemDescription.trim() !== '' ? row.itemDescription.trim() : row.sku;
  const inserted = await db.sql`
    INSERT INTO products
      (organization_id, barcode, sku, name, cost_price, notes, created_at, updated_at)
    VALUES
      (${organizationId}, ${barcode}, ${row.sku}, ${name}, 0,
       'Created during expiry list import', NOW(), NOW())
    RETURNING id
  `;
  const id = Number(inserted[0].id);
  cache.set(cacheKey, id);
  return id;
}

async function createUniqueImportBarcode(
  db: Database,
  organizationId: string,
  sku: string,
): Promise<string> {
  const base = `EXP-IMPORT-${sku.replace(/\s+/g, '-')}`;
  let candidate = base;
  let suffix = 1;

  // Bound the loop defensively; collisions past this are astronomically unlikely.
  while (suffix < 10000) {
    const exists = await db.sql`
      SELECT id FROM products
      WHERE organization_id = ${organizationId} AND barcode = ${candidate}
      LIMIT 1
    `;
    if (!exists[0]) {
      return candidate;
    }
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return `${base}-${Date.now()}`;
}

async function getOrCreateStoreArea(
  db: Database,
  organizationId: string,
  name: string,
  cache: Map<string, number>,
): Promise<number> {
  const cached = cache.get(name);
  if (cached !== undefined) {
    return cached;
  }

  const existing = await db.sql`
    SELECT id FROM store_areas
    WHERE organization_id = ${organizationId} AND name = ${name}
    ORDER BY id ASC
    LIMIT 1
  `;
  if (existing[0]) {
    const id = Number(existing[0].id);
    cache.set(name, id);
    return id;
  }

  const created = await db.sql`
    INSERT INTO store_areas (organization_id, name, sub_department, created_at, updated_at)
    VALUES (${organizationId}, ${name}, '', NOW(), NOW())
    RETURNING id
  `;
  const id = Number(created[0].id);
  cache.set(name, id);
  return id;
}
