/**
 * Master-catalogue seeding (task 3.4, issue #393).
 *
 * Replaces `SeedService.seedMasterCatalogue` and its Prisma-bound runner
 * (`backend/scripts/seed-master-catalogue.ts`). The shared master catalogue is
 * upserted by barcode from a curated workbook: new barcodes are inserted,
 * changed rows updated, rows the workbook no longer lists are retired (never
 * deleted — tenant products still reference them), and a retired row that
 * returns is reinstated in place. Every live run appends one
 * `catalogue_seed_runs` row.
 *
 * Three guardrails carry over unchanged: a workbook with any validation error
 * writes nothing; a run that would retire more than the threshold share of the
 * active catalogue is refused unless explicitly confirmed; and `dryRun`
 * reports the prospective diff without touching the database.
 *
 * Two things are deliberately different from the Express seeder:
 *
 *   - Text fields are formula-escaped on the way in. The catalogue feeds brand
 *     and product text into every tenant, and the repository rule is that the
 *     control sits at ingestion (`shared/domain/csv-injection.ts`). The Express
 *     seeder stored workbook text raw.
 *   - A workbook missing a required column fails once, on the header, instead
 *     of once per data row.
 *
 * This module is database- and file-format-agnostic: it takes rows already
 * read from a sheet and a `MigrationClient`, so the same code runs against
 * `pg` in the CLI and against pglite in tests.
 */
import { escapeSpreadsheetFormula } from '../../shared/domain/csv-injection';
import { MigrationExecutionError, type MigrationClient } from '../database/migrations/runner';

export const SAMPLE_WORKBOOK_NAME = 'sample_100_ipa_price_brands.xlsx';
export const DEFAULT_RETIREMENT_THRESHOLD = 0.1;

const REQUIRED_HEADERS = ['Description', 'Barcode', 'Brand'] as const;
const UPSERT_BATCH_SIZE = 1000;

export interface MasterCatalogueSeedEntry {
  barcode: string;
  description: string;
  apiSku: string | null;
  sigmaSku: string | null;
  ch2Sku: string | null;
  brandName: string;
  manufacturerName: string | null;
  category: string | null;
  subCategory: string | null;
  rrp: number | null;
  metroPrice: number | null;
}

export interface MasterCatalogueRowError {
  row: number;
  message: string;
}

export interface MasterCatalogueParseResult {
  entries: MasterCatalogueSeedEntry[];
  skipped: number;
  errors: MasterCatalogueRowError[];
}

export interface MasterCatalogueSeedResult {
  inserted: number;
  updated: number;
  unchanged: number;
  retired: number;
  reinstated: number;
  skippedBlankRows: number;
  errorCount: number;
  errors: MasterCatalogueRowError[];
  retiredBarcodes: string[];
  dryRun: boolean;
  /** `catalogue_seed_runs.version` written by a live run; null for a dry run. */
  seedRunVersion: number | null;
}

export interface MasterCatalogueSeedOptions {
  /** Recorded as `catalogue_seed_runs.source_file_name`. */
  sourceFileName: string;
  dryRun?: boolean;
  confirmRetirements?: boolean;
  /** Share of the active catalogue a run may retire unconfirmed, 0 to 1. */
  retirementThreshold?: number;
  now?: Date;
}

export class CatalogueSeedValidationError extends Error {
  constructor(public readonly result: MasterCatalogueSeedResult) {
    super(`Master catalogue workbook contains ${result.errorCount} validation error(s)`);
    this.name = 'CatalogueSeedValidationError';
  }
}

export class RetirementThresholdExceeded extends Error {
  constructor(
    public readonly retired: number,
    public readonly activeBefore: number,
    public readonly proportion: number,
    public readonly threshold: number,
  ) {
    super(
      `Retiring ${retired} of ${activeBefore} active catalogue entries (${proportion}) exceeds threshold ${threshold}`,
    );
    this.name = 'RetirementThresholdExceeded';
  }
}

/** Parses `MASTER_CATALOGUE_RETIREMENT_THRESHOLD`; unset or blank means the default. */
export function resolveRetirementThreshold(configured: string | undefined): number {
  if (configured == null || configured.trim() === '') return DEFAULT_RETIREMENT_THRESHOLD;
  const threshold = Number(configured);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error(
      'MASTER_CATALOGUE_RETIREMENT_THRESHOLD must be a number between 0 and 1 inclusive',
    );
  }
  return threshold;
}

function textValue(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function safeTextValue(value: unknown): string | null {
  const text = textValue(value);
  return text == null ? null : escapeSpreadsheetFormula(text);
}

function skuValue(value: unknown): string | null {
  return safeTextValue(value)?.toUpperCase() ?? null;
}

function priceValue(value: unknown): number | null {
  const text = textValue(value);
  if (text == null) return null;
  const parsed = Number(text.replace(/[$,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Turns sheet rows (header first) into catalogue entries. Row numbers in
 * errors are 1-based sheet rows, so the header is row 1 and the first data
 * row is row 2.
 */
export function normalizeMasterCatalogueRows(rows: unknown[][]): MasterCatalogueParseResult {
  const [headerRow = [], ...dataRows] = rows;
  const headers = new Map(
    headerRow.map((header, index) => [textValue(header)?.toUpperCase() ?? '', index]),
  );
  const missingHeaders = REQUIRED_HEADERS.filter((name) => !headers.has(name.toUpperCase()));
  if (missingHeaders.length > 0) {
    return {
      entries: [],
      skipped: 0,
      errors: [
        {
          row: 1,
          message: `Header row is missing required column(s): ${missingHeaders.join(', ')}`,
        },
      ],
    };
  }
  const at = (row: unknown[], name: string): unknown => {
    const index = headers.get(name.toUpperCase());
    return index == null ? undefined : row[index];
  };

  const entries: MasterCatalogueSeedEntry[] = [];
  const errors: MasterCatalogueRowError[] = [];
  const barcodeRows = new Map<string, number>();
  let skipped = 0;

  dataRows.forEach((row, index) => {
    const rowNumber = index + 2;
    if (row.every((value) => textValue(value) == null)) {
      skipped += 1;
      return;
    }

    const description = safeTextValue(at(row, 'Description'));
    const barcode = safeTextValue(at(row, 'Barcode'));
    const brandName = safeTextValue(at(row, 'Brand'));
    if (!description || !barcode || !brandName) {
      errors.push({ row: rowNumber, message: 'Description, barcode, and brand are required' });
      return;
    }

    const firstRow = barcodeRows.get(barcode);
    if (firstRow != null) {
      errors.push({
        row: rowNumber,
        message: `Duplicate barcode ${barcode}; first seen on row ${firstRow}`,
      });
      return;
    }
    barcodeRows.set(barcode, rowNumber);

    entries.push({
      barcode,
      description,
      apiSku: skuValue(at(row, 'API PDE')),
      sigmaSku: skuValue(at(row, 'Sigma PDE')),
      ch2Sku: skuValue(at(row, 'CH2 PDE')),
      brandName,
      manufacturerName: safeTextValue(at(row, 'Manufacturer')),
      category: safeTextValue(at(row, 'Category')),
      subCategory: safeTextValue(at(row, 'Sub-Category')),
      rrp: priceValue(at(row, 'RRP $')),
      metroPrice: priceValue(at(row, 'Metro $')),
    });
  });

  return { entries, skipped, errors };
}

interface ExistingEntry extends MasterCatalogueSeedEntry {
  retired: boolean;
}

interface ExistingEntryRow {
  barcode: string;
  description: string;
  api_sku: string | null;
  sigma_sku: string | null;
  ch2_sku: string | null;
  brand_name: string;
  manufacturer_name: string | null;
  category: string | null;
  sub_category: string | null;
  rrp: number | string | null;
  metro_price: number | string | null;
  retired: boolean;
}

function numberOrNull(value: number | string | null): number | null {
  return value == null ? null : Number(value);
}

async function loadExistingEntries(client: MigrationClient): Promise<ExistingEntry[]> {
  const result = await client.query(
    `SELECT barcode, description, api_sku, sigma_sku, ch2_sku, brand_name, manufacturer_name,
            category, sub_category, rrp, metro_price, retired_at IS NOT NULL AS retired
     FROM master_catalogue_entries`,
  );
  return (result.rows as ExistingEntryRow[]).map((row) => ({
    barcode: row.barcode,
    description: row.description,
    apiSku: row.api_sku,
    sigmaSku: row.sigma_sku,
    ch2Sku: row.ch2_sku,
    brandName: row.brand_name,
    manufacturerName: row.manufacturer_name,
    category: row.category,
    subCategory: row.sub_category,
    rrp: numberOrNull(row.rrp),
    metroPrice: numberOrNull(row.metro_price),
    retired: row.retired,
  }));
}

function entryMatches(existing: MasterCatalogueSeedEntry, expected: MasterCatalogueSeedEntry) {
  return (
    existing.description === expected.description &&
    existing.apiSku === expected.apiSku &&
    existing.sigmaSku === expected.sigmaSku &&
    existing.ch2Sku === expected.ch2Sku &&
    existing.brandName === expected.brandName &&
    existing.manufacturerName === expected.manufacturerName &&
    existing.category === expected.category &&
    existing.subCategory === expected.subCategory &&
    existing.rrp === expected.rrp &&
    existing.metroPrice === expected.metroPrice
  );
}

interface SeedPlan {
  result: MasterCatalogueSeedResult;
  /** Entries to insert, update, or reinstate — everything except unchanged rows. */
  toUpsert: MasterCatalogueSeedEntry[];
  activeBefore: number;
}

function planSeed(parsed: MasterCatalogueParseResult, existing: ExistingEntry[]): SeedPlan {
  const workbookBarcodes = new Set(parsed.entries.map((entry) => entry.barcode));
  const existingByBarcode = new Map(existing.map((entry) => [entry.barcode, entry]));
  const retiredBarcodes = existing
    .filter((entry) => !entry.retired && !workbookBarcodes.has(entry.barcode))
    .map((entry) => entry.barcode)
    .sort();

  const result: MasterCatalogueSeedResult = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    retired: retiredBarcodes.length,
    reinstated: 0,
    skippedBlankRows: parsed.skipped,
    errorCount: parsed.errors.length,
    errors: [...parsed.errors],
    retiredBarcodes,
    dryRun: true,
    seedRunVersion: null,
  };

  const toUpsert: MasterCatalogueSeedEntry[] = [];
  for (const entry of parsed.entries) {
    const current = existingByBarcode.get(entry.barcode);
    if (!current) result.inserted += 1;
    else if (current.retired) result.reinstated += 1;
    else if (entryMatches(current, entry)) {
      result.unchanged += 1;
      continue;
    } else result.updated += 1;
    toUpsert.push(entry);
  }

  return { result, toUpsert, activeBefore: existing.filter((entry) => !entry.retired).length };
}

const UPSERT_SQL = `
  INSERT INTO master_catalogue_entries
    (barcode, description, api_sku, sigma_sku, ch2_sku, brand_name, manufacturer_name,
     category, sub_category, rrp, metro_price, retired_at, updated_at)
  SELECT e.barcode, e.description, e."apiSku", e."sigmaSku", e."ch2Sku", e."brandName",
         e."manufacturerName", e.category, e."subCategory", e.rrp, e."metroPrice", NULL, NOW()
  FROM jsonb_to_recordset($1::jsonb) AS e(
    barcode text, description text, "apiSku" text, "sigmaSku" text, "ch2Sku" text,
    "brandName" text, "manufacturerName" text, category text, "subCategory" text,
    rrp double precision, "metroPrice" double precision
  )
  ON CONFLICT (barcode) DO UPDATE SET
    description = EXCLUDED.description,
    api_sku = EXCLUDED.api_sku,
    sigma_sku = EXCLUDED.sigma_sku,
    ch2_sku = EXCLUDED.ch2_sku,
    brand_name = EXCLUDED.brand_name,
    manufacturer_name = EXCLUDED.manufacturer_name,
    category = EXCLUDED.category,
    sub_category = EXCLUDED.sub_category,
    rrp = EXCLUDED.rrp,
    metro_price = EXCLUDED.metro_price,
    retired_at = NULL,
    updated_at = NOW()`;

async function applySeed(
  client: MigrationClient,
  parsed: MasterCatalogueParseResult,
  options: MasterCatalogueSeedOptions,
  threshold: number,
): Promise<MasterCatalogueSeedResult> {
  // Blocks a second seeder for the length of the transaction and leaves
  // readers alone, so the snapshot the counts are computed from is the one the
  // writes land on.
  await client.query('LOCK TABLE master_catalogue_entries IN SHARE ROW EXCLUSIVE MODE');
  const { result, toUpsert, activeBefore } = planSeed(parsed, await loadExistingEntries(client));

  const proportion = activeBefore === 0 ? 0 : result.retired / activeBefore;
  if (activeBefore > 0 && proportion > threshold && options.confirmRetirements !== true) {
    throw new RetirementThresholdExceeded(result.retired, activeBefore, proportion, threshold);
  }

  for (let offset = 0; offset < toUpsert.length; offset += UPSERT_BATCH_SIZE) {
    const batch = toUpsert.slice(offset, offset + UPSERT_BATCH_SIZE);
    await client.query(UPSERT_SQL, [JSON.stringify(batch)]);
  }

  const seededAt = (options.now ?? new Date()).toISOString();
  if (result.retiredBarcodes.length > 0) {
    await client.query(
      `UPDATE master_catalogue_entries
       SET retired_at = $1::timestamptz, updated_at = NOW()
       WHERE retired_at IS NULL
         AND barcode IN (SELECT jsonb_array_elements_text($2::jsonb))`,
      [seededAt, JSON.stringify(result.retiredBarcodes)],
    );
  }

  const run = await client.query(
    `INSERT INTO catalogue_seed_runs
       (version, seeded_at, source_file_name, inserted, updated, unchanged, retired, reinstated,
        error_count)
     SELECT COALESCE(MAX(version), 0) + 1, $1::timestamptz, $2, $3, $4, $5, $6, $7, 0
     FROM catalogue_seed_runs
     RETURNING version`,
    [
      seededAt,
      options.sourceFileName,
      result.inserted,
      result.updated,
      result.unchanged,
      result.retired,
      result.reinstated,
    ],
  );

  return {
    ...result,
    dryRun: false,
    seedRunVersion: Number((run.rows[0] as { version: number | string }).version),
  };
}

/**
 * Seeds the master catalogue from parsed workbook rows.
 *
 * A dry run, and any run whose workbook has validation errors, only reads. A
 * live run is one transaction: either the catalogue changes and its
 * `catalogue_seed_runs` row are both committed, or neither is.
 */
export async function seedMasterCatalogue(
  client: MigrationClient,
  parsed: MasterCatalogueParseResult,
  options: MasterCatalogueSeedOptions,
): Promise<MasterCatalogueSeedResult> {
  const threshold = options.retirementThreshold ?? DEFAULT_RETIREMENT_THRESHOLD;

  if (options.dryRun === true || parsed.errors.length > 0) {
    const { result } = planSeed(parsed, await loadExistingEntries(client));
    if (options.dryRun === true) return result;
    throw new CatalogueSeedValidationError(result);
  }

  await client.query('BEGIN');
  let result: MasterCatalogueSeedResult;
  try {
    result = await applySeed(client, parsed, options, threshold);
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      throw new MigrationExecutionError('Catalogue seed failed and rollback also failed', [
        error,
        rollbackError,
      ]);
    }
    throw error;
  }
  return result;
}
