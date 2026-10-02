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
 * Three things are deliberately different from the Express seeder:
 *
 *   - A run that would blank stored values on more than the threshold share of
 *     the entries it matches is refused unless explicitly confirmed. Optional
 *     columns are matched by exact header, so a renamed `RRP $` reads as empty
 *     on every row and would otherwise null every stored price with no error.
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

/** Entry fields a workbook may leave empty. Every one of them is nullable in the table. */
const OPTIONAL_FIELDS = [
  'apiSku',
  'sigmaSku',
  'ch2Sku',
  'manufacturerName',
  'category',
  'subCategory',
  'rrp',
  'metroPrice',
] as const;
export type OptionalField = (typeof OPTIONAL_FIELDS)[number];

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
  /** Existing entries that would lose a stored value in at least one optional field. */
  blankedEntries: number;
  /** Per optional field, how many existing entries would go from a value to none. */
  blankedFields: Partial<Record<OptionalField, number>>;
  dryRun: boolean;
  /** `catalogue_seed_runs.version` written by a live run; null for a dry run. */
  seedRunVersion: number | null;
}

export interface MasterCatalogueSeedOptions {
  /** Recorded as `catalogue_seed_runs.source_file_name`. */
  sourceFileName: string;
  dryRun?: boolean;
  confirmRetirements?: boolean;
  confirmBlankedFields?: boolean;
  /**
   * Share, 0 to 1, a run may change unconfirmed: of the active catalogue for
   * retirements, and of the entries the workbook matches for blanked fields.
   */
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

/**
 * Thrown when a run would blank stored values across more of the catalogue
 * than the threshold allows. A renamed or misspelled optional column makes
 * every row read as empty for that field, with no row-level error to show for
 * it; this is what stops that from nulling a column for the whole catalogue.
 */
export class BlankingThresholdExceeded extends Error {
  constructor(
    public readonly blankedEntries: number,
    public readonly matchedEntries: number,
    public readonly proportion: number,
    public readonly threshold: number,
    public readonly blankedFields: Partial<Record<OptionalField, number>>,
  ) {
    super(
      `Blanking stored values on ${blankedEntries} of ${matchedEntries} existing catalogue entries (${proportion}) exceeds threshold ${threshold}; fields: ${JSON.stringify(blankedFields)}`,
    );
    this.name = 'BlankingThresholdExceeded';
  }
}

function isProportion(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Parses `MASTER_CATALOGUE_RETIREMENT_THRESHOLD`; unset or blank means the default. */
export function resolveRetirementThreshold(configured: string | undefined): number {
  if (configured == null || configured.trim() === '') return DEFAULT_RETIREMENT_THRESHOLD;
  const threshold = Number(configured);
  if (!isProportion(threshold)) {
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

  const entries: MasterCatalogueSeedEntry[] = [];
  const errors: MasterCatalogueRowError[] = [];
  const barcodeRows = new Map<string, number>();
  let skipped = 0;

  dataRows.forEach((row, index) => {
    const rowNumber = index + 2;
    if (isBlankRow(row)) {
      skipped += 1;
      return;
    }
    const outcome = readRow(headers, row, barcodeRows);
    if (typeof outcome === 'string') {
      errors.push({ row: rowNumber, message: outcome });
      return;
    }
    barcodeRows.set(outcome.barcode, rowNumber);
    entries.push(outcome);
  });

  return { entries, skipped, errors };
}

/** The entry a data row describes, or the reason it is rejected. */
function readRow(
  headers: Map<string, number>,
  row: unknown[],
  barcodeRows: Map<string, number>,
): MasterCatalogueSeedEntry | string {
  const entry = entryFromRow((name) => cellAt(headers, row, name));
  if (entry === null) return 'Description, barcode, and brand are required';
  const firstRow = barcodeRows.get(entry.barcode);
  if (firstRow != null) return `Duplicate barcode ${entry.barcode}; first seen on row ${firstRow}`;
  return entry;
}

function isBlankRow(row: unknown[]): boolean {
  return row.every((value) => textValue(value) == null);
}

function cellAt(headers: Map<string, number>, row: unknown[], name: string): unknown {
  const index = headers.get(name.toUpperCase());
  return index == null ? undefined : row[index];
}

/** The entry a row describes, or null when a required field is empty. */
function entryFromRow(at: (name: string) => unknown): MasterCatalogueSeedEntry | null {
  const description = safeTextValue(at('Description'));
  const barcode = safeTextValue(at('Barcode'));
  const brandName = safeTextValue(at('Brand'));
  if (!description || !barcode || !brandName) return null;
  return {
    barcode,
    description,
    apiSku: skuValue(at('API PDE')),
    sigmaSku: skuValue(at('Sigma PDE')),
    ch2Sku: skuValue(at('CH2 PDE')),
    brandName,
    manufacturerName: safeTextValue(at('Manufacturer')),
    category: safeTextValue(at('Category')),
    subCategory: safeTextValue(at('Sub-Category')),
    rrp: priceValue(at('RRP $')),
    metroPrice: priceValue(at('Metro $')),
  };
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
    existing.brandName === expected.brandName &&
    OPTIONAL_FIELDS.every((field) => existing[field] === expected[field])
  );
}

/** Optional fields where `existing` holds a value and the workbook entry holds none. */
function blankedFieldsOf(
  existing: MasterCatalogueSeedEntry,
  entry: MasterCatalogueSeedEntry,
): OptionalField[] {
  return OPTIONAL_FIELDS.filter((field) => existing[field] != null && entry[field] == null);
}

interface SeedPlan {
  result: MasterCatalogueSeedResult;
  /** Entries to insert, update, or reinstate — everything except unchanged rows. */
  toUpsert: MasterCatalogueSeedEntry[];
  activeBefore: number;
  /** Workbook entries whose barcode is already in the catalogue, retired or not. */
  matchedEntries: number;
}

type SeedAction = 'inserted' | 'reinstated' | 'unchanged' | 'updated';

function classify(current: ExistingEntry | undefined, entry: MasterCatalogueSeedEntry): SeedAction {
  if (!current) return 'inserted';
  if (current.retired) return 'reinstated';
  return entryMatches(current, entry) ? 'unchanged' : 'updated';
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
    blankedEntries: 0,
    blankedFields: {},
    dryRun: true,
    seedRunVersion: null,
  };

  const toUpsert: MasterCatalogueSeedEntry[] = [];
  let matchedEntries = 0;
  for (const entry of parsed.entries) {
    const current = existingByBarcode.get(entry.barcode);
    const action = classify(current, entry);
    result[action] += 1;
    if (action !== 'unchanged') toUpsert.push(entry);
    if (!current) continue;

    matchedEntries += 1;
    const blanked = blankedFieldsOf(current, entry);
    if (blanked.length > 0) result.blankedEntries += 1;
    for (const field of blanked) {
      result.blankedFields[field] = (result.blankedFields[field] ?? 0) + 1;
    }
  }

  return {
    result,
    toUpsert,
    activeBefore: existing.filter((entry) => !entry.retired).length,
    matchedEntries,
  };
}

/** True when `count` is more than `threshold` of a non-empty `total`. */
function exceedsShare(count: number, total: number, threshold: number): boolean {
  return total > 0 && count / total > threshold;
}

/** Refuses a plan that retires or blanks more than the threshold without confirmation. */
function assertWithinThresholds(
  plan: SeedPlan,
  options: MasterCatalogueSeedOptions,
  threshold: number,
): void {
  const { result, activeBefore, matchedEntries } = plan;
  if (
    options.confirmRetirements !== true &&
    exceedsShare(result.retired, activeBefore, threshold)
  ) {
    throw new RetirementThresholdExceeded(
      result.retired,
      activeBefore,
      result.retired / activeBefore,
      threshold,
    );
  }
  if (
    options.confirmBlankedFields !== true &&
    exceedsShare(result.blankedEntries, matchedEntries, threshold)
  ) {
    throw new BlankingThresholdExceeded(
      result.blankedEntries,
      matchedEntries,
      result.blankedEntries / matchedEntries,
      threshold,
      result.blankedFields,
    );
  }
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
  const plan = planSeed(parsed, await loadExistingEntries(client));
  assertWithinThresholds(plan, options, threshold);
  const { result, toUpsert } = plan;

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

  return inTransaction(client, () => applySeed(client, parsed, options, threshold));
}

/** Runs `work` between BEGIN and COMMIT, rolling back and rethrowing if it fails. */
async function inTransaction<T>(client: MigrationClient, work: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const value = await work();
    await client.query('COMMIT');
    return value;
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
}
