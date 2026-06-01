import { validateCSVColumns } from '../csvValidator';
import * as XLSX from 'xlsx';

describe('validateCSVColumns', () => {
  it('preserves first-match behavior for duplicate headers', async () => {
    const file = new File(
      ['SKU,sku,Name,Cost,Barcode\nfirst,second,Widget,1.23,123456789'],
      'catalog.csv',
      {
        type: 'text/csv',
      },
    );

    const result = await validateCSVColumns(file, 'product-catalog');

    expect(result.isValid).toBe(true);
    expect(result.foundColumns.sku).toBe('SKU');
  });

  it('accepts XLSX product catalog headers from FRED exports', async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Item Code', 'Item Description', 'Cost Ex', 'Barcode'],
      ['619647', 'A/SEARCH NEB TUBING 2M', '$7.53', '9318766200185'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    const workbookBytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const file = new File([workbookBytes], 'fred-export.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const result = await validateCSVColumns(file, 'product-catalog');

    expect(result.isValid).toBe(true);
    expect(result.foundColumns).toEqual({
      sku: 'Item Code',
      name: 'Item Description',
      cost: 'Cost Ex',
      barcode: 'Barcode',
    });
  });
});
