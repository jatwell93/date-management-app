import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CatalogueSeedValidationError,
  RetirementThresholdExceeded,
  type MasterCatalogueSeedResult,
} from './master-catalogue-seed';
import {
  assertSafeSeedInvocation,
  parseSeedMasterCatalogueArgs,
  serializeSeedMasterCatalogueError,
} from './seed-master-catalogue-cli';

test('parses a workbook path and supported flags', () => {
  assert.deepEqual(parseSeedMasterCatalogueArgs(['catalogue.xlsx']), {
    workbookPath: 'catalogue.xlsx',
    dryRun: false,
    confirmRetirements: false,
  });
  assert.deepEqual(
    parseSeedMasterCatalogueArgs(['--confirm-retirements', 'catalogue.xlsx', '--dry-run']),
    { workbookPath: 'catalogue.xlsx', dryRun: true, confirmRetirements: true },
  );
});

test('rejects missing paths, unknown flags, and multiple workbook paths', () => {
  assert.throws(() => parseSeedMasterCatalogueArgs([]), /workbook path is required/);
  assert.throws(() => parseSeedMasterCatalogueArgs(['--dry-run']), /workbook path is required/);
  assert.throws(
    () => parseSeedMasterCatalogueArgs(['catalogue.xlsx', '--force']),
    /Unknown option: --force/,
  );
  assert.throws(
    () => parseSeedMasterCatalogueArgs(['a.xlsx', 'b.xlsx']),
    /exactly one workbook path/,
  );
});

test('rejects a live production seed from the sample workbook, wherever it was copied', () => {
  const live = { dryRun: false, confirmRetirements: true };
  for (const workbookPath of [
    'supplier-doc-examples/sample_100_ipa_price_brands.xlsx',
    '/tmp/SAMPLE_100_IPA_PRICE_BRANDS.XLSX',
  ]) {
    assert.throws(
      () => assertSafeSeedInvocation({ workbookPath, ...live }, 'production'),
      /Refusing to live-seed the production catalogue from the sample workbook/,
    );
  }

  const sample = 'supplier-doc-examples/sample_100_ipa_price_brands.xlsx';
  assert.doesNotThrow(() =>
    assertSafeSeedInvocation({ workbookPath: sample, ...live, dryRun: true }, 'production'),
  );
  assert.doesNotThrow(() =>
    assertSafeSeedInvocation({ workbookPath: sample, ...live }, 'development'),
  );
  assert.doesNotThrow(() =>
    assertSafeSeedInvocation({ workbookPath: 'full_catalogue.xlsx', ...live }, 'production'),
  );
});

test('preserves validation details and the prospective diff in CLI JSON', () => {
  const result: MasterCatalogueSeedResult = {
    inserted: 3,
    updated: 1,
    unchanged: 0,
    retired: 2,
    reinstated: 0,
    skippedBlankRows: 1,
    errorCount: 1,
    errors: [{ row: 7, message: 'Duplicate barcode 123; first seen on row 2' }],
    retiredBarcodes: ['111', '222'],
    dryRun: true,
    seedRunVersion: null,
  };

  assert.deepEqual(serializeSeedMasterCatalogueError(new CatalogueSeedValidationError(result)), {
    name: 'CatalogueSeedValidationError',
    message: 'Master catalogue workbook contains 1 validation error(s)',
    result,
  });
  assert.deepEqual(
    serializeSeedMasterCatalogueError(new RetirementThresholdExceeded(40, 100, 0.4, 0.1)),
    {
      name: 'RetirementThresholdExceeded',
      message: 'Retiring 40 of 100 active catalogue entries (0.4) exceeds threshold 0.1',
      retired: 40,
      activeBefore: 100,
      proportion: 0.4,
      threshold: 0.1,
    },
  );
  assert.deepEqual(serializeSeedMasterCatalogueError(new Error('connect ECONNREFUSED')), {
    name: 'Error',
    message: 'connect ECONNREFUSED',
  });
  assert.deepEqual(serializeSeedMasterCatalogueError('plain'), {
    name: 'Error',
    message: 'plain',
  });
});
