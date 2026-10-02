/**
 * Master-catalogue seed tests (task 3.4).
 *
 * The seeding cases run the real SQL against pglite with the schema produced
 * by replaying `database/migrations/` — the same adapter pattern as
 * `src/database/migrations/commands.test.ts`. One migrated instance is shared
 * by the file and the two catalogue tables are truncated between tests.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test, { after, before, beforeEach } from 'node:test';

import {
  applyPendingMigrations,
  loadMigrationHistory,
  type MigrationClient,
} from '../database/migrations/runner';
import {
  createPgliteMigrationClient,
  type PgliteInstance,
} from '../database/migrations/pglite-client';
import {
  BlankingThresholdExceeded,
  CatalogueSeedValidationError,
  normalizeMasterCatalogueRows,
  resolveRetirementThreshold,
  RetirementThresholdExceeded,
  seedMasterCatalogue,
  type MasterCatalogueParseResult,
} from './master-catalogue-seed';
import { cellPrimitive, parseMasterCatalogueWorkbook } from './master-catalogue-workbook';

const SAMPLE_WORKBOOK = path.resolve('supplier-doc-examples/sample_100_ipa_price_brands.xlsx');
const HEADER = ['Description', 'API PDE', 'Barcode', 'Brand', 'RRP $'];

function workbook(...dataRows: unknown[][]): MasterCatalogueParseResult {
  return normalizeMasterCatalogueRows([HEADER, ...dataRows]);
}

function product(n: number, overrides: { description?: string; rrp?: unknown } = {}): unknown[] {
  return [
    overrides.description ?? `Product ${n}`,
    `api-${n}`,
    `93000000000${String(n).padStart(2, '0')}`,
    'Brand',
    overrides.rrp ?? 9.99,
  ];
}

// ===========================================================================
// Parsing (no database)
// ===========================================================================

test('parses and normalizes the checked-in 100-row catalogue sample', async () => {
  const parsed = await parseMasterCatalogueWorkbook(SAMPLE_WORKBOOK);

  assert.equal(parsed.entries.length, 99);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.entries[0], {
    barcode: '9321299800449',
    description: 'CANCER COUNC HYDRATING SPF50+ MENS 100ML',
    apiSku: '192418',
    sigmaSku: '10031800',
    ch2Sku: null,
    brandName: 'THE CANCER COUNCIL',
    manufacturerName: 'VITALITY BRANDS WORLDWIDE',
    category: 'SUN CARE',
    subCategory: 'SUN BLOCK 50+',
    rrp: 19.99,
    metroPrice: 19.49,
  });
});

test('counts blank and malformed catalogue rows without inventing values', () => {
  const normalized = normalizeMasterCatalogueRows([
    ['Description', 'API PDE', 'Sigma PDE', 'CH2 PDE', 'Barcode', 'Brand'],
    ['Valid product', ' api-1 ', '', '', ' 9300000000001 ', ' Valid Brand '],
    [],
    ['Missing barcode', 'api-2', '', '', '', 'Brand'],
  ]);

  assert.deepEqual(normalized.entries, [
    {
      barcode: '9300000000001',
      description: 'Valid product',
      apiSku: 'API-1',
      sigmaSku: null,
      ch2Sku: null,
      brandName: 'Valid Brand',
      manufacturerName: null,
      category: null,
      subCategory: null,
      rrp: null,
      metroPrice: null,
    },
  ]);
  assert.equal(normalized.skipped, 1);
  assert.deepEqual(normalized.errors, [
    { row: 4, message: 'Description, barcode, and brand are required' },
  ]);
});

test('reports a duplicate barcode against the row it was first seen on', () => {
  const parsed = workbook(product(1), product(2), product(1, { description: 'Again' }));

  assert.equal(parsed.entries.length, 2);
  assert.deepEqual(parsed.errors, [
    { row: 4, message: 'Duplicate barcode 9300000000001; first seen on row 2' },
  ]);
});

test('fails once on the header when a required column is missing', () => {
  const parsed = normalizeMasterCatalogueRows([
    ['Description', 'API PDE', 'Brand'],
    ['Product 1', 'api-1', 'Brand'],
    ['Product 2', 'api-2', 'Brand'],
  ]);

  assert.deepEqual(parsed, {
    entries: [],
    skipped: 0,
    errors: [{ row: 1, message: 'Header row is missing required column(s): Barcode' }],
  });
});

test('formula-escapes text fields and leaves prices numeric', () => {
  const parsed = workbook(['=HYPERLINK("http://x")', '+cmd', '9300000000001', '@Brand', '-5']);

  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.entries[0].description, '\'=HYPERLINK("http://x")');
  assert.equal(parsed.entries[0].apiSku, "'+CMD");
  assert.equal(parsed.entries[0].brandName, "'@Brand");
  assert.equal(parsed.entries[0].rrp, -5);
});

test('parses prices written with currency symbols and drops unparseable ones', () => {
  const parsed = workbook(product(1, { rrp: '$1,299.50' }), product(2, { rrp: 'POA' }));

  assert.equal(parsed.entries[0].rrp, 1299.5);
  assert.equal(parsed.entries[1].rrp, null);
});

test('cellPrimitive reduces workbook cell shapes to what the cell displays', () => {
  assert.equal(cellPrimitive(undefined), null);
  assert.equal(cellPrimitive(null), null);
  assert.equal(cellPrimitive(9321299800449), 9321299800449);
  assert.equal(cellPrimitive({ formula: 'A1*2', result: 19.99 }), 19.99);
  assert.equal(cellPrimitive({ formula: 'A1', result: { error: '#N/A' } }), null);
  assert.equal(
    cellPrimitive({ richText: [{ text: 'KLEENEX ' }, { text: 'WIPES' }] }),
    'KLEENEX WIPES',
  );
  assert.equal(cellPrimitive({ text: 'Brand', hyperlink: 'https://example.test' }), 'Brand');
  assert.equal(cellPrimitive({ error: '#REF!' }), null);
});

test('resolveRetirementThreshold defaults when unset and rejects out-of-range values', () => {
  assert.equal(resolveRetirementThreshold(undefined), 0.1);
  assert.equal(resolveRetirementThreshold('  '), 0.1);
  assert.equal(resolveRetirementThreshold('0'), 0);
  assert.equal(resolveRetirementThreshold('0.25'), 0.25);
  for (const invalid of ['-0.1', '1.01', 'ten percent', 'NaN']) {
    assert.throws(() => resolveRetirementThreshold(invalid), /between 0 and 1 inclusive/);
  }
});

// ===========================================================================
// Seeding (pglite)
// ===========================================================================

let pg: PgliteInstance;
let client: MigrationClient;

before(async () => {
  const mod = (await import('@electric-sql/pglite')) as { PGlite: new () => PgliteInstance };
  pg = new mod.PGlite();
  client = createPgliteMigrationClient(pg);
  const history = await loadMigrationHistory(path.resolve('database/migrations'));
  await applyPendingMigrations(client, history, { deploymentSha: 'a'.repeat(40) });
});

after(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec('TRUNCATE master_catalogue_entries, catalogue_seed_runs RESTART IDENTITY CASCADE');
});

async function rows<T>(sql: string): Promise<T[]> {
  return (await pg.query(sql)).rows as T[];
}

async function counts(): Promise<{ entries: number; active: number; runs: number }> {
  const [row] = await rows<{ entries: number; active: number; runs: number }>(
    `SELECT (SELECT COUNT(*)::int FROM master_catalogue_entries) AS entries,
            (SELECT COUNT(*)::int FROM master_catalogue_entries WHERE retired_at IS NULL) AS active,
            (SELECT COUNT(*)::int FROM catalogue_seed_runs) AS runs`,
  );
  return row;
}

const OPTIONS = { sourceFileName: 'catalogue.xlsx' };

test('upserts the workbook by barcode and is idempotent on rerun', async () => {
  const parsed = await parseMasterCatalogueWorkbook(SAMPLE_WORKBOOK);

  const first = await seedMasterCatalogue(client, parsed, OPTIONS);
  assert.deepEqual(
    {
      inserted: first.inserted,
      updated: first.updated,
      unchanged: first.unchanged,
      retired: first.retired,
      reinstated: first.reinstated,
      dryRun: first.dryRun,
      seedRunVersion: first.seedRunVersion,
    },
    {
      inserted: 99,
      updated: 0,
      unchanged: 0,
      retired: 0,
      reinstated: 0,
      dryRun: false,
      seedRunVersion: 1,
    },
  );

  // Every stored row must read back equal to the workbook, prices included, or
  // the rerun would count float round-trip noise as updates.
  const second = await seedMasterCatalogue(client, parsed, OPTIONS);
  assert.equal(second.inserted, 0);
  assert.equal(second.updated, 0);
  assert.equal(second.unchanged, 99);
  assert.equal(second.seedRunVersion, 2);

  assert.deepEqual(await counts(), { entries: 99, active: 99, runs: 2 });
  assert.deepEqual(
    await rows(
      `SELECT version, source_file_name, inserted, updated, unchanged, retired, reinstated, error_count
       FROM catalogue_seed_runs ORDER BY version`,
    ),
    [
      {
        version: 1,
        source_file_name: 'catalogue.xlsx',
        inserted: 99,
        updated: 0,
        unchanged: 0,
        retired: 0,
        reinstated: 0,
        error_count: 0,
      },
      {
        version: 2,
        source_file_name: 'catalogue.xlsx',
        inserted: 0,
        updated: 0,
        unchanged: 99,
        retired: 0,
        reinstated: 0,
        error_count: 0,
      },
    ],
  );
});

test('counts only changed catalogue records as updates and writes the change', async () => {
  await seedMasterCatalogue(client, workbook(product(1), product(2), product(3)), OPTIONS);

  const result = await seedMasterCatalogue(
    client,
    workbook(product(1), product(2, { description: 'Renamed', rrp: 12.5 }), product(3)),
    OPTIONS,
  );

  assert.equal(result.updated, 1);
  assert.equal(result.unchanged, 2);
  assert.deepEqual(
    await rows(
      `SELECT barcode, description, rrp FROM master_catalogue_entries
       WHERE description <> 'Product 1' AND description <> 'Product 3'`,
    ),
    [{ barcode: '9300000000002', description: 'Renamed', rrp: 12.5 }],
  );
});

test('retires omitted entries and reinstates the same row when they return', async () => {
  const full = workbook(...Array.from({ length: 20 }, (_, i) => product(i + 1)));
  await seedMasterCatalogue(client, full, OPTIONS);
  const [{ id: originalId }] = await rows<{ id: number }>(
    `SELECT id FROM master_catalogue_entries WHERE barcode = '9300000000020'`,
  );

  const now = new Date('2026-10-02T03:04:05.000Z');
  const without = workbook(...Array.from({ length: 19 }, (_, i) => product(i + 1)));
  const retired = await seedMasterCatalogue(client, without, { ...OPTIONS, now });

  assert.equal(retired.retired, 1);
  assert.deepEqual(retired.retiredBarcodes, ['9300000000020']);
  assert.equal(retired.unchanged, 19);
  assert.deepEqual(await counts(), { entries: 20, active: 19, runs: 2 });
  const [{ retired_at: retiredAt }] = await rows<{ retired_at: Date }>(
    `SELECT retired_at FROM master_catalogue_entries WHERE barcode = '9300000000020'`,
  );
  assert.equal(new Date(retiredAt).toISOString(), now.toISOString());

  // A retired row the workbook still omits is not retired a second time.
  const again = await seedMasterCatalogue(client, without, OPTIONS);
  assert.equal(again.retired, 0);

  const reinstated = await seedMasterCatalogue(client, full, OPTIONS);
  assert.equal(reinstated.reinstated, 1);
  assert.equal(reinstated.inserted, 0);
  assert.deepEqual(
    await rows(
      `SELECT id, retired_at FROM master_catalogue_entries WHERE barcode = '9300000000020'`,
    ),
    [{ id: originalId, retired_at: null }],
  );
});

test('a dry run reports the prospective diff and writes nothing', async () => {
  await seedMasterCatalogue(client, workbook(product(1), product(2)), OPTIONS);
  const before = await counts();

  const result = await seedMasterCatalogue(
    client,
    workbook(product(1, { description: 'Renamed' }), product(3)),
    { ...OPTIONS, dryRun: true },
  );

  assert.equal(result.dryRun, true);
  assert.equal(result.seedRunVersion, null);
  assert.equal(result.inserted, 1);
  assert.equal(result.updated, 1);
  assert.deepEqual(result.retiredBarcodes, ['9300000000002']);
  assert.deepEqual(await counts(), before);
  assert.deepEqual(
    await rows(`SELECT description FROM master_catalogue_entries ORDER BY barcode`),
    [{ description: 'Product 1' }, { description: 'Product 2' }],
  );
});

test('reports validation errors in a dry run and aborts a live run before any write', async () => {
  const invalid = workbook(product(1), product(1, { description: 'Duplicate' }), product(2));

  const dryRun = await seedMasterCatalogue(client, invalid, { ...OPTIONS, dryRun: true });
  assert.equal(dryRun.errorCount, 1);
  assert.equal(dryRun.inserted, 2);

  await assert.rejects(
    () => seedMasterCatalogue(client, invalid, OPTIONS),
    (error: unknown) => {
      assert.ok(error instanceof CatalogueSeedValidationError);
      assert.equal(error.result.errorCount, 1);
      assert.equal(error.result.dryRun, true);
      assert.equal(error.result.inserted, 2);
      return true;
    },
  );
  assert.deepEqual(await counts(), { entries: 0, active: 0, runs: 0 });
});

test('rolls back catalogue writes when the seed-run insert fails', async () => {
  await seedMasterCatalogue(client, workbook(product(1), product(2)), OPTIONS);

  const failing: MigrationClient = {
    async query(text, values) {
      if (text.includes('INSERT INTO catalogue_seed_runs')) {
        throw new Error('provenance insert failed');
      }
      return client.query(text, values);
    },
  };

  await assert.rejects(
    () =>
      seedMasterCatalogue(
        failing,
        workbook(product(1, { description: 'Renamed' }), product(2), product(3)),
        OPTIONS,
      ),
    /provenance insert failed/,
  );

  // The upsert ran before the failure; only a real rollback restores these.
  assert.deepEqual(await counts(), { entries: 2, active: 2, runs: 1 });
  assert.deepEqual(
    await rows(`SELECT description FROM master_catalogue_entries ORDER BY barcode`),
    [{ description: 'Product 1' }, { description: 'Product 2' }],
  );

  // The connection is usable afterwards — the transaction was closed, not left aborted.
  const next = await seedMasterCatalogue(client, workbook(product(1), product(2)), OPTIONS);
  assert.equal(next.unchanged, 2);
});

test('refuses a mass retirement unless confirmed, and writes nothing when refused', async () => {
  const full = workbook(...Array.from({ length: 10 }, (_, i) => product(i + 1)));
  await seedMasterCatalogue(client, full, OPTIONS);
  const shrunk = workbook(...Array.from({ length: 8 }, (_, i) => product(i + 1)));

  await assert.rejects(
    () => seedMasterCatalogue(client, shrunk, { ...OPTIONS, retirementThreshold: 0.1 }),
    (error: unknown) => {
      assert.ok(error instanceof RetirementThresholdExceeded);
      assert.deepEqual(
        [error.retired, error.activeBefore, error.proportion, error.threshold],
        [2, 10, 0.2, 0.1],
      );
      return true;
    },
  );
  assert.deepEqual(await counts(), { entries: 10, active: 10, runs: 1 });

  // Exactly at the threshold is allowed: the rule is "exceeds", not "reaches".
  const atThreshold = await seedMasterCatalogue(client, shrunk, {
    ...OPTIONS,
    retirementThreshold: 0.2,
  });
  assert.equal(atThreshold.retired, 2);
  assert.deepEqual(await counts(), { entries: 10, active: 8, runs: 2 });

  const confirmed = await seedMasterCatalogue(client, workbook(product(1)), {
    ...OPTIONS,
    retirementThreshold: 0,
    confirmRetirements: true,
  });
  assert.equal(confirmed.retired, 7);
  assert.deepEqual(await counts(), { entries: 10, active: 1, runs: 3 });
});

test('seeds an empty catalogue under a zero threshold', async () => {
  const result = await seedMasterCatalogue(client, workbook(product(1)), {
    ...OPTIONS,
    retirementThreshold: 0,
  });
  assert.equal(result.inserted, 1);
});

test('seeds a workbook larger than one upsert batch', async () => {
  const header = ['Description', 'Barcode', 'Brand'];
  const dataRows = Array.from({ length: 2500 }, (_, i) => [
    `Product ${i}`,
    `94${String(i).padStart(11, '0')}`,
    'Brand',
  ]);
  const parsed = normalizeMasterCatalogueRows([header, ...dataRows]);

  const result = await seedMasterCatalogue(client, parsed, OPTIONS);

  assert.equal(result.inserted, 2500);
  assert.deepEqual(await counts(), { entries: 2500, active: 2500, runs: 1 });
});

test('refuses to plan against a stored barcode that was never formula-escaped', async () => {
  // A row as a seeder without the escape would have stored it.
  await pg.query(
    `INSERT INTO master_catalogue_entries (barcode, description, brand_name)
     VALUES ('-9300000000001', 'Legacy', 'Brand')`,
  );
  const parsed = workbook(['Legacy', 'api-1', '-9300000000001', 'Brand', 1]);
  assert.equal(parsed.entries[0].barcode, "'-9300000000001");

  for (const dryRun of [true, false]) {
    await assert.rejects(
      () => seedMasterCatalogue(client, parsed, { ...OPTIONS, dryRun }),
      /1 stored barcode\(s\) are not formula-escaped and would not match the workbook: -9300000000001/,
    );
  }
  assert.deepEqual(await counts(), { entries: 1, active: 1, runs: 0 });
});

// ===========================================================================
// Blanked fields
// ===========================================================================

/** Ten products with prices, under a header whose price column is spelled `priceHeader`. */
function pricedWorkbook(priceHeader: string, price: (n: number) => unknown = () => 9.99) {
  return normalizeMasterCatalogueRows([
    ['Description', 'API PDE', 'Barcode', 'Brand', priceHeader],
    ...Array.from({ length: 10 }, (_, i) => [
      `Product ${i + 1}`,
      `api-${i + 1}`,
      `93000000000${String(i + 1).padStart(2, '0')}`,
      'Brand',
      price(i + 1),
    ]),
  ]);
}

test('refuses a renamed price column that would null every stored price', async () => {
  await seedMasterCatalogue(client, pricedWorkbook('RRP $'), OPTIONS);
  const misspelled = pricedWorkbook('RRP');

  const dryRun = await seedMasterCatalogue(client, misspelled, { ...OPTIONS, dryRun: true });
  assert.equal(dryRun.blankedEntries, 10);
  assert.deepEqual(dryRun.blankedFields, { rrp: 10 });
  assert.equal(dryRun.updated, 10);

  await assert.rejects(
    () => seedMasterCatalogue(client, misspelled, OPTIONS),
    (error: unknown) => {
      assert.ok(error instanceof BlankingThresholdExceeded);
      assert.deepEqual(
        [error.blankedEntries, error.matchedEntries, error.proportion, error.threshold],
        [10, 10, 1, 0.1],
      );
      assert.deepEqual(error.blankedFields, { rrp: 10 });
      return true;
    },
  );
  assert.deepEqual(await rows(`SELECT DISTINCT rrp FROM master_catalogue_entries`), [
    { rrp: 9.99 },
  ]);
  assert.deepEqual(await counts(), { entries: 10, active: 10, runs: 1 });

  // Confirmed, the operator gets exactly what they agreed to.
  const confirmed = await seedMasterCatalogue(client, misspelled, {
    ...OPTIONS,
    confirmBlankedFields: true,
  });
  assert.equal(confirmed.blankedEntries, 10);
  assert.deepEqual(await rows(`SELECT DISTINCT rrp FROM master_catalogue_entries`), [
    { rrp: null },
  ]);
});

test('lets a few blanked values through under the threshold and reports them', async () => {
  await seedMasterCatalogue(client, pricedWorkbook('RRP $'), OPTIONS);

  // One price withdrawn ("POA") out of ten is 0.1: at the threshold, not over it.
  const result = await seedMasterCatalogue(
    client,
    pricedWorkbook('RRP $', (n) => (n === 3 ? 'POA' : 9.99)),
    OPTIONS,
  );

  assert.equal(result.blankedEntries, 1);
  assert.deepEqual(result.blankedFields, { rrp: 1 });
  assert.deepEqual(await rows(`SELECT barcode FROM master_catalogue_entries WHERE rrp IS NULL`), [
    { barcode: '9300000000003' },
  ]);
});

test('counts only stored values lost, not new entries or values that were already empty', async () => {
  await seedMasterCatalogue(client, workbook(product(1)), OPTIONS);

  // Product 1 never had a Sigma or CH2 sku, and product 2 is new: nothing is blanked.
  const result = await seedMasterCatalogue(client, workbook(product(1), product(2, { rrp: '' })), {
    ...OPTIONS,
    retirementThreshold: 0,
  });

  assert.equal(result.inserted, 1);
  assert.equal(result.blankedEntries, 0);
  assert.deepEqual(result.blankedFields, {});
});
