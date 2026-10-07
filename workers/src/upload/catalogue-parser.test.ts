import { describe, expect, it } from 'vitest';
import { parseProductCatalogRow, validateCatalogueRecords } from './catalogue-parser';
import { parseCsvRecords } from './csv-parser';

describe('Worker catalogue parser', () => {
  it('accepts known product catalogue header aliases', () => {
    const result = validateCatalogueRecords([
      ['Item Code', 'Item Description', 'Cost Ex', 'Barcode'],
      ['619647', 'Nebuliser Tubing', '7.53', '9318766200185'],
    ]);

    expect(result.fatalErrors).toEqual([]);
    expect(result.rowErrors).toEqual([]);
    expect(result.totalRows).toBe(1);
    expect(result.rows[0]).toMatchObject({
      sku: '619647',
      name: 'Nebuliser Tubing',
      barcode: '9318766200185',
      costPrice: 7.53,
      rowNumber: 2,
    });
  });

  it('rejects rows with malformed required values', () => {
    const row = parseProductCatalogRow(['SKU-1', 'Milk', 'BAR-1', 'not-money'], {
      sku: 0,
      name: 1,
      barcode: 2,
      cost: 3,
    });

    expect(row).toBeNull();
  });

  // Task 3.2 batch 4. The Worker used to drop every character that was not a digit,
  // dot or minus, so "12,50" became 1250 and "(12.50)" became +12.5. Cost cells now
  // go through the same parser Express used (`shared/domain/product-import-cost.ts`).
  it.each([
    ['12,50', 12.5],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['$7.53', 7.53],
    ['(12.50)', -12.5],
    ['AUD 7.53', 7.53],
  ])('reads the cost cell %s as %d', (cell, expected) => {
    const result = validateCatalogueRecords([
      ['SKU', 'Name', 'Cost', 'Barcode'],
      ['SKU-1', 'Milk', cell, 'BAR-1'],
    ]);

    expect(result.rows[0]?.costPrice).toBe(expected);
  });

  it('reads an optional retail price with the same rules', () => {
    const result = validateCatalogueRecords([
      ['SKU', 'Name', 'Cost', 'Retail Price', 'Barcode'],
      ['SKU-1', 'Milk', '4,20', '€1.234,56', 'BAR-1'],
    ]);

    expect(result.rows[0]).toMatchObject({ costPrice: 4.2, retailPrice: 1234.56 });
  });

  // Task 3.2 batch 6. Express rejected a file whose header row lacked a required column
  // before reading any product row; the Worker must do the same, naming every missing column.
  it('rejects the whole file and names each required column that is missing', () => {
    const result = validateCatalogueRecords([
      ['Name', 'Barcode'],
      ['Milk', 'BAR-1'],
    ]);

    expect(result.rows).toEqual([]);
    expect(result.totalRows).toBe(0);
    expect(result.fatalErrors).toEqual(['Missing required column header(s): sku, cost']);
  });

  it('reports a file with a header and no product rows as empty', () => {
    expect(validateCatalogueRecords([['SKU', 'Name', 'Cost', 'Barcode']]).fatalErrors).toEqual([
      'No product rows found',
    ]);
  });

  it('skips blank lines, numbers rows from the file, and flags in-file duplicates', () => {
    const result = validateCatalogueRecords([
      ['SKU', 'Name', 'Cost', 'Barcode'],
      ['SKU-1', 'Milk', '1.00', 'BAR-1'],
      ['', '', '', ''],
      ['sku-1', 'Milk again', '1.00', 'BAR-2'],
      ['SKU-3', 'Bread', '2.00', 'BAR-1'],
      ['SKU-4', 'Eggs', 'free', 'BAR-4'],
    ]);

    expect(result.rows.map((row) => row.rowNumber)).toEqual([2]);
    expect(result.totalRows).toBe(4);
    expect(result.rowErrors).toEqual([
      'Row 4: Duplicate SKU or barcode in upload',
      'Row 5: Duplicate SKU or barcode in upload',
      'Row 6: Missing or malformed required product fields',
    ]);
  });

  // Express refused a SKU or barcode over 100 characters and a name over 200 (csv.upload.test.ts,
  // "values that exceed length limits"). The Worker had no limit until batch 6.
  it.each([
    ['Name', 200],
    ['SKU', 100],
    ['Barcode', 100],
  ] as const)(
    'rejects a row whose %s is over %d characters, and accepts one at the limit',
    (field, max) => {
      const row = (value: string) =>
        ({
          Name: ['SKU-1', value, '1.00', 'BAR-1'],
          SKU: [value, 'Milk', '1.00', 'BAR-1'],
          Barcode: ['SKU-1', 'Milk', '1.00', value],
        })[field];
      const header = ['SKU', 'Name', 'Cost', 'Barcode'];

      const refused = validateCatalogueRecords([header, row('x'.repeat(max + 1))]);
      const accepted = validateCatalogueRecords([header, row('x'.repeat(max))]);

      expect(refused.rows).toEqual([]);
      expect(refused.rowErrors).toHaveLength(1);
      expect(
        refused.rowErrors[0].startsWith(`Row 2: ${field} too long (max ${max} characters)`),
      ).toBe(true);
      expect(accepted.rowErrors).toEqual([]);
      expect(accepted.rows).toHaveLength(1);
    },
  );

  // Express refused a file with a column it did not know ("Unexpected columns found"). The
  // Worker reads the columns it recognises and ignores the rest, which is what lets a supplier
  // export with extra columns (pack size, GST, ...) import without editing the file.
  it('ignores columns it does not recognise instead of rejecting the file', () => {
    const result = validateCatalogueRecords([
      ['Item Code', 'Pack Size', 'Item Description', 'GST', 'Cost Ex', 'Barcode'],
      ['619647', '12', 'Nebuliser Tubing', 'Y', '7.53', '9318766200185'],
    ]);

    expect(result.fatalErrors).toEqual([]);
    expect(result.rowErrors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      sku: '619647',
      name: 'Nebuliser Tubing',
      costPrice: 7.53,
    });
  });

  it('rejects, rather than silently importing, the rows after an unterminated quote', () => {
    const result = validateCatalogueRecords(
      parseCsvRecords('SKU,Name,Cost,Barcode\nS1,"Milk,1.00,B1\nS2,Bread,2.00,B2\n'),
    );

    expect(result.rows).toEqual([]);
    expect(result.rowErrors).toEqual(['Row 2: Missing or malformed required product fields']);
  });

  // Express: "errors in large files are handled without aborting the run". One bad row among
  // thousands must not stop the rows after it.
  it('keeps importing the valid rows after an invalid one, and reports only the invalid row', () => {
    const rows = Array.from({ length: 2000 }, (_, i) => [`S${i}`, `Item ${i}`, '1.00', `B${i}`]);
    rows[1000] = ['S1000', 'Item 1000', 'not-money', 'B1000'];

    const result = validateCatalogueRecords([['SKU', 'Name', 'Cost', 'Barcode'], ...rows]);

    expect(result.rows).toHaveLength(1999);
    expect(result.totalRows).toBe(2000);
    expect(result.rowErrors).toEqual(['Row 1002: Missing or malformed required product fields']);
  });
});
