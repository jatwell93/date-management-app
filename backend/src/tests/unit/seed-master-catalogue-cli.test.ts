import path from 'node:path';
import {
  assertSafeSeedInvocation,
  parseSeedMasterCatalogueArgs,
  serializeSeedMasterCatalogueError,
} from '../../../scripts/seed-master-catalogue';
import { CatalogueSeedValidationError } from '../../services/seed.service';

describe('seed master catalogue CLI', () => {
  it('parses a workbook path and supported flags', () => {
    expect(
      parseSeedMasterCatalogueArgs([
        'C:\\catalogues\\master.xlsx',
        '--dry-run',
        '--confirm-retirements',
      ]),
    ).toEqual({
      workbookPath: 'C:\\catalogues\\master.xlsx',
      dryRun: true,
      confirmRetirements: true,
    });
  });

  it('rejects missing paths, unknown flags, and multiple workbook paths', () => {
    expect(() => parseSeedMasterCatalogueArgs([])).toThrow('workbook path');
    expect(() => parseSeedMasterCatalogueArgs(['master.xlsx', '--unknown'])).toThrow(
      'Unknown option',
    );
    expect(() => parseSeedMasterCatalogueArgs(['one.xlsx', 'two.xlsx'])).toThrow(
      'exactly one workbook path',
    );
  });

  it('rejects a live production seed from the checked-in sample workbook', () => {
    const sampleWorkbook = path.resolve(
      __dirname,
      '../../../../supplier-doc-examples/sample_100_ipa_price_brands.xlsx',
    );

    expect(() =>
      assertSafeSeedInvocation(
        {
          workbookPath: sampleWorkbook,
          dryRun: false,
          confirmRetirements: false,
        },
        'production',
      ),
    ).toThrow('sample workbook');
    expect(() =>
      assertSafeSeedInvocation(
        {
          workbookPath: sampleWorkbook,
          dryRun: true,
          confirmRetirements: false,
        },
        'production',
      ),
    ).not.toThrow();
  });

  it('preserves validation details and the prospective diff in CLI JSON', () => {
    const serialized = JSON.parse(
      JSON.stringify(
        serializeSeedMasterCatalogueError(
          new CatalogueSeedValidationError({
            inserted: 1,
            updated: 2,
            unchanged: 3,
            retired: 4,
            reinstated: 5,
            skippedBlankRows: 6,
            errorCount: 1,
            errors: [{ row: 7, message: 'Duplicate barcode 9300000000001' }],
            retiredBarcodes: ['9300000000002'],
            dryRun: true,
          }),
        ),
      ),
    );

    expect(serialized).toMatchObject({
      name: 'CatalogueSeedValidationError',
      result: {
        inserted: 1,
        retired: 4,
        errorCount: 1,
        errors: [{ row: 7, message: 'Duplicate barcode 9300000000001' }],
        retiredBarcodes: ['9300000000002'],
      },
    });
  });
});
