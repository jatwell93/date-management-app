/**
 * CSV formula-injection escaping on the Worker ingestion paths (#473).
 *
 * The control existed only in Express (`validateProductRowStrictly` /
 * `validateExpiryRowStrictly`) and was lost when catalogue and expiry ingestion
 * moved to the Worker, which trimmed the same fields and stored them raw. These
 * cases are ported from `backend/src/tests/services/csv-injection.test.ts` so
 * the two backends are held to one rule; the raw-storage counterpart, asserting
 * what actually lands in `products`, lives in the pglite tests in
 * `__tests__/catalogue-import-upsert.node.test.ts` and
 * `__tests__/expiry-import.node.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { parseProductCatalogRow, validateCatalogueRecords } from './catalogue-parser';
import { validateExpiryRecords } from './expiry-parser';

type CatalogueField = 'sku' | 'name' | 'barcode';

const CATALOGUE_COLUMNS = { sku: 0, name: 1, barcode: 2, cost: 3, retail: 4 };

/** Parse one catalogue row with `value` in `field` and everything else safe. */
function catalogueField(value: string, field: CatalogueField = 'sku'): string {
  const cells = ['SAFE-SKU', 'Safe Product', '123456789', '12.99', '19.99'];
  cells[CATALOGUE_COLUMNS[field]] = value;
  const row = parseProductCatalogRow(cells, CATALOGUE_COLUMNS);
  expect(row).not.toBeNull();
  return row![field];
}

/** Parse one expiry row with `value` in `field` and everything else safe. */
function expiryField(value: string, field: 'sku' | 'itemDescription' | 'department'): string {
  const cells: Record<string, string> = {
    sku: 'SAFE-SKU',
    itemDescription: 'Safe Product',
    department: 'Vitamins',
  };
  cells[field] = value;
  const result = validateExpiryRecords([
    ['SKU', 'Item Description', 'Used-By Date', 'Department'],
    [cells.sku, cells.itemDescription, '12/12/26', cells.department],
  ]);
  expect(result.rowErrors).toEqual([]);
  expect(result.rows).toHaveLength(1);
  return String(result.rows[0][field] ?? '');
}

describe('catalogue ingestion escapes spreadsheet formulas', () => {
  it.each([
    ['equals sign', '=SUM(A1:A10)', "'=SUM(A1:A10)"],
    ['plus sign', '+1234567890', "'+1234567890"],
    ['minus sign', '-cmd|calc', "'-cmd|calc"],
    ['at sign', '@SUM(A1:A10)', "'@SUM(A1:A10)"],
    ['tab-prefixed formula', '\t=A1', "'=A1"],
    ['carriage-return-prefixed formula', '\r=A1', "'=A1"],
  ])('escapes a leading %s with an apostrophe', (_label, value, expected) => {
    expect(catalogueField(value)).toBe(expected);
  });

  it('escapes sku, name, and barcode - not one or two of them', () => {
    const result = validateCatalogueRecords([
      ['SKU', 'Name', 'Barcode', 'Cost'],
      ['=SKU_FORMULA', '+NAME_FORMULA', '@BARCODE_FORMULA', '12.99'],
    ]);

    expect(result.fatalErrors).toEqual([]);
    expect(result.rowErrors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      sku: "'=SKU_FORMULA",
      name: "'+NAME_FORMULA",
      barcode: "'@BARCODE_FORMULA",
    });
  });

  it('handles command, DDE, and hyperlink injection attempts', () => {
    expect(catalogueField('=cmd|"/c calc"')).toBe('\'=cmd|"/c calc"');
    expect(catalogueField('-2+3+cmd|"/c calc"')).toBe('\'-2+3+cmd|"/c calc"');
    expect(catalogueField('+cmd|"/c calc"')).toBe('\'+cmd|"/c calc"');
    expect(catalogueField('@cmd|"/c calc"')).toBe('\'@cmd|"/c calc"');
    expect(catalogueField('=cmd|"/c powershell"!A1')).toBe('\'=cmd|"/c powershell"!A1');
    expect(catalogueField('+DDE("cmd";"/c calc";"!A0")')).toBe('\'+DDE("cmd";"/c calc";"!A0")');
    expect(catalogueField('=HYPERLINK("http://evil.com","Click here")')).toBe(
      '\'=HYPERLINK("http://evil.com","Click here")',
    );
  });

  it('escapes once, at the front only', () => {
    // Double-prefixing corrupts legitimate data, so the rule adds exactly one
    // apostrophe no matter how many operators the value contains.
    expect(catalogueField('=SUM(A1)=5')).toBe("'=SUM(A1)=5");
    expect(catalogueField('=A1+B2-C3')).toBe("'=A1+B2-C3");
  });

  it('leaves safe values untouched', () => {
    expect(catalogueField('Normal Product Name', 'name')).toBe('Normal Product Name');
    expect(catalogueField('SKU-12345')).toBe('SKU-12345');
    expect(catalogueField('987654321', 'barcode')).toBe('987654321');
    expect(catalogueField('Product (with parentheses)', 'name')).toBe('Product (with parentheses)');
    expect(catalogueField('Cafe Muller', 'name')).toBe('Cafe Muller');
    expect(catalogueField('Product, Description', 'name')).toBe('Product, Description');
    expect(catalogueField('Product "Name"', 'name')).toBe('Product "Name"');
  });

  it('does not escape an operator that is not the first character', () => {
    // A non-leading operator cannot start a formula, and escaping it would
    // rewrite ordinary product names.
    expect(catalogueField('Price: $10.99 = value', 'name')).toBe('Price: $10.99 = value');
    expect(catalogueField('Total: 5+3', 'name')).toBe('Total: 5+3');
    expect(catalogueField('Range: 10-20', 'name')).toBe('Range: 10-20');
    expect(catalogueField('Email: user@example.com', 'name')).toBe('Email: user@example.com');
  });

  it('stores cost and retail as numbers, so neither can carry a formula', () => {
    // These two are not escaped because they are never stored as text: parseCost
    // either yields a number or the row is rejected. Asserting the type is what
    // makes the omission safe rather than an oversight.
    const row = parseProductCatalogRow(
      ['SKU-1', 'Milk', 'BAR-1', '=1+1', '=2+2'],
      CATALOGUE_COLUMNS,
    );
    expect(typeof row!.costPrice).toBe('number');
    expect(typeof row!.retailPrice).toBe('number');

    const rejected = parseProductCatalogRow(
      ['SKU-1', 'Milk', 'BAR-1', '=HYPERLINK("http://evil.com")'],
      { sku: 0, name: 1, barcode: 2, cost: 3 },
    );
    expect(rejected).toBeNull();
  });
});

describe('expiry ingestion escapes spreadsheet formulas', () => {
  // The expiry import persists sku, itemDescription and department as product
  // and store-area names, so it needs the same control the catalogue path has.
  // Express escapes all three in validateExpiryRowStrictly.
  it.each(['sku', 'itemDescription', 'department'] as const)('escapes %s', (field) => {
    expect(expiryField('=SUM(A1:A10)', field)).toBe("'=SUM(A1:A10)");
    expect(expiryField('\t=A1', field)).toBe("'=A1");
    expect(expiryField('@cmd|"/c calc"', field)).toBe('\'@cmd|"/c calc"');
  });

  it('leaves safe expiry values untouched', () => {
    expect(expiryField('1001', 'sku')).toBe('1001');
    expect(expiryField('Vitamin C 500mg', 'itemDescription')).toBe('Vitamin C 500mg');
    expect(expiryField('Health & Beauty', 'department')).toBe('Health & Beauty');
  });

  it('does not escape the used-by date, which is parsed rather than stored as text', () => {
    const result = validateExpiryRecords([
      ['SKU', 'Item Description', 'Used-By Date'],
      ['1001', 'Vitamin C 500mg', '12/12/26'],
    ]);
    expect(result.rows[0].usedByDate).toBe('2026-12-12');
  });
});
