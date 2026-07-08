import type { Database } from '../database';
import type { Env } from '../types/env';
import { errorResponse, jsonResponse } from '../utils/worker-response';
import * as Sentry from '@sentry/cloudflare';
import {
  findHeaderIndex,
  normalizeHeader,
  parseProductCatalogRow,
  PRODUCT_CATALOG_HEADER_ALIASES,
  type ProductCatalogRow,
} from './catalogue-parser';
import { parseCsvRecords } from './csv-parser';
import { processExpiryListUpload } from './expiry-import';

export type UploadCompleteBody = { key?: string; importType?: string };

export type UploadObjectMetadata = {
  size?: number;
  httpMetadata?: { contentType?: string };
};

export type QueueCompletedCatalogueUploadDeps<TTier extends string> = {
  getOrganizationLaunchTier: (organizationId: string, db: Database) => Promise<TTier>;
  createQueuedCatalogueUpload: (input: {
    db: Database;
    organizationId: string;
    userId: number;
    key: string;
    fileName: string;
    fileSize: number;
    contentType: string;
    tier: TTier;
    env: Env;
  }) => Promise<number | null>;
  enqueueCatalogueImport: (env: Env, db: Database, uploadId: number) => Promise<boolean>;
};

export type ProcessCompletedUploadSyncDeps<TSummary extends Record<string, unknown>> = {
  processStoredUpload: (
    key: string,
    organizationId: string,
    env: Env,
    db: Database,
    importType?: string,
  ) => Promise<TSummary>;
};

export async function parseUploadCompleteBody(request: Request): Promise<UploadCompleteBody> {
  return (await request.json()) as UploadCompleteBody;
}

export function userOwnsUploadKey(key: string, userId: number): boolean {
  return key.startsWith(`uploads/user-${userId}/`);
}

export async function queueCompletedCatalogueUpload<TTier extends string>(input: {
  env: Env;
  db: Database;
  key: string;
  object: UploadObjectMetadata;
  organizationId: string;
  userId: number;
  deps: QueueCompletedCatalogueUploadDeps<TTier>;
}): Promise<Response> {
  if (!input.env.CATALOGUE_IMPORT_QUEUE) {
    return errorResponse('Catalogue import queue is not configured', 503, input.env);
  }

  const tier = await input.deps.getOrganizationLaunchTier(input.organizationId, input.db);
  const uploadId = await input.deps.createQueuedCatalogueUpload({
    db: input.db,
    organizationId: input.organizationId,
    userId: input.userId,
    key: input.key,
    fileName: input.key.split('/').pop() || 'catalogue.csv',
    fileSize: Number(input.object.size || 0),
    contentType: input.object.httpMetadata?.contentType || 'text/csv',
    tier,
    env: input.env,
  });
  if (uploadId === null) {
    return errorResponse(
      'An active catalogue import already exists for this organization',
      409,
      input.env,
    );
  }

  const queued = await input.deps.enqueueCatalogueImport(input.env, input.db, uploadId);
  if (!queued) {
    return errorResponse('Catalogue import queue is temporarily unavailable', 503, input.env);
  }

  return jsonResponse(
    { message: 'Catalogue upload queued', key: input.key, uploadId, status: 'queued' },
    202,
    input.env,
  );
}

export async function processCompletedUploadSync<TSummary extends Record<string, unknown>>(input: {
  env: Env;
  db: Database;
  key: string;
  organizationId: string;
  importType?: string;
  deps: ProcessCompletedUploadSyncDeps<TSummary>;
}): Promise<Response> {
  try {
    const processingSummary = await input.deps.processStoredUpload(
      input.key,
      input.organizationId,
      input.env,
      input.db,
      input.importType,
    );
    return jsonResponse(
      { message: 'Upload completed and processing started', ...processingSummary },
      200,
      input.env,
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Upload not found') {
      return errorResponse('Upload not found', 404, input.env);
    }
    throw error;
  }
}

export type UploadProcessingSummary = {
  rowsProcessed: number;
  rowsTotal: number;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  errors: string[];
};

function emptyUploadProcessingSummary(): UploadProcessingSummary {
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

export function serializeUploadProcessingSummary(
  summary: UploadProcessingSummary,
): Record<string, string> {
  return {
    rowsProcessed: String(summary.rowsProcessed),
    rowsTotal: String(summary.rowsTotal),
    importedCount: String(summary.importedCount),
    updatedCount: String(summary.updatedCount),
    skippedCount: String(summary.skippedCount),
    errorCount: String(summary.errorCount),
    errors: JSON.stringify(summary.errors),
  };
}

export function parseUploadProcessingSummary(
  customMetadata?: Record<string, string>,
): UploadProcessingSummary {
  if (!customMetadata) {
    return emptyUploadProcessingSummary();
  }

  let errors: string[] = [];
  try {
    const parsedErrors = JSON.parse(customMetadata.errors || '[]') as unknown;
    if (Array.isArray(parsedErrors)) {
      errors = parsedErrors.filter((error): error is string => typeof error === 'string');
    }
  } catch {
    errors = [];
  }

  return {
    rowsProcessed: parseMetadataNumber(customMetadata.rowsProcessed),
    rowsTotal: parseMetadataNumber(customMetadata.rowsTotal),
    importedCount: parseMetadataNumber(customMetadata.importedCount),
    updatedCount: parseMetadataNumber(customMetadata.updatedCount),
    skippedCount: parseMetadataNumber(customMetadata.skippedCount),
    errorCount: parseMetadataNumber(customMetadata.errorCount),
    errors,
  };
}

function parseMetadataNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export async function processStoredUpload(
  key: string,
  organizationId: string,
  env: Env,
  db: Database,
  importType?: string,
): Promise<UploadProcessingSummary> {
  if (typeof env.CSV_UPLOADS.get !== 'function') {
    return emptyUploadProcessingSummary();
  }

  const object = await env.CSV_UPLOADS.get(key);
  if (!object) {
    throw new Error('Upload not found');
  }

  const data = await object.arrayBuffer();
  const processingSummary =
    importType === 'expiry-list'
      ? await processExpiryListUpload(data, organizationId, db)
      : await processProductCatalogUpload(data, organizationId, db);

  await env.CSV_UPLOADS.put(key, data, {
    httpMetadata: {
      contentType: object.httpMetadata?.contentType || 'text/csv',
    },
    customMetadata: serializeUploadProcessingSummary(processingSummary),
  });

  return processingSummary;
}

export async function processProductCatalogUpload(
  data: ArrayBuffer,
  organizationId: string,
  db: Database,
): Promise<UploadProcessingSummary> {
  const summary = emptyUploadProcessingSummary();
  const text = new TextDecoder().decode(data);
  const records = parseCsvRecords(text);

  if (records.length < 2) {
    summary.errors.push('No product rows found');
    summary.errorCount = summary.errors.length;
    return summary;
  }

  const headers = records[0].map(normalizeHeader);
  const columnIndexes = {
    sku: findHeaderIndex(headers, PRODUCT_CATALOG_HEADER_ALIASES.sku),
    name: findHeaderIndex(headers, PRODUCT_CATALOG_HEADER_ALIASES.name),
    barcode: findHeaderIndex(headers, PRODUCT_CATALOG_HEADER_ALIASES.barcode),
    cost: findHeaderIndex(headers, PRODUCT_CATALOG_HEADER_ALIASES.cost),
  };

  const missingHeaders = Object.entries(columnIndexes)
    .filter(([, index]) => index === -1)
    .map(([name]) => name);
  if (missingHeaders.length > 0) {
    summary.errors.push(`Missing required column header(s): ${missingHeaders.join(', ')}`);
    summary.errorCount = summary.errors.length;
    return summary;
  }

  const rows = records.slice(1).filter((row) => row.some((cell) => cell.trim()));
  summary.rowsTotal = rows.length;

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const parsedRow = parseProductCatalogRow(row, columnIndexes);
    if (!parsedRow) {
      summary.skippedCount += 1;
      summary.errors.push(`Row ${rowNumber}: Missing required product fields`);
      continue;
    }

    try {
      const wasInserted = await upsertProductFromUpload(db, organizationId, parsedRow);
      if (wasInserted) {
        summary.importedCount += 1;
      } else {
        summary.updatedCount += 1;
      }
    } catch (error) {
      Sentry.captureException(error, {
        tags: { feature: 'worker-upload', action: 'product-import-row' },
        extra: { rowNumber },
      });
      summary.skippedCount += 1;
      summary.errors.push(`Row ${rowNumber}: Product import failed`);
    }
  }

  summary.rowsProcessed = summary.importedCount + summary.updatedCount + summary.skippedCount;
  summary.errorCount = summary.errors.length;
  return summary;
}

async function upsertProductFromUpload(
  db: Database,
  organizationId: string,
  row: ProductCatalogRow,
): Promise<boolean> {
  const rows = await db.sql`
    WITH updated AS (
      UPDATE products
      SET barcode = ${row.barcode},
          sku = ${row.sku},
          name = ${row.name},
          cost_price = ${row.costPrice},
          retail_price = ${row.retailPrice},
          updated_at = NOW()
      WHERE organization_id = ${organizationId}
        AND (sku = ${row.sku} OR barcode = ${row.barcode})
      RETURNING id
    ),
    inserted AS (
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, retail_price, notes, created_at, updated_at)
      SELECT ${organizationId}, ${row.barcode}, ${row.sku}, ${row.name}, ${row.costPrice}, ${row.retailPrice}, '', NOW(), NOW()
      WHERE NOT EXISTS (SELECT 1 FROM updated)
      RETURNING id
    )
    SELECT (EXISTS(SELECT 1 FROM inserted))::int as inserted
  `;
  return Number(rows[0]?.inserted) === 1;
}
