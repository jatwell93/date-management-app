import { validateCSVColumns } from '../csvValidator';
import * as XLSX from 'xlsx';

const fredCatalogRows = [
  ['Item Code', 'Item Description', 'Cost Ex', 'Barcode'],
  ['619647', 'A/SEARCH NEB TUBING 2M', '$7.53', '9318766200185'],
];

function createWorkbookFile(fileName: string, bookType: XLSX.BookType, mimeType: string): File {
  const worksheet = XLSX.utils.aoa_to_sheet(fredCatalogRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const workbookBytes = XLSX.write(workbook, { type: 'array', bookType });

  return new File([workbookBytes], fileName, { type: mimeType });
}

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
    const file = createWorkbookFile(
      'fred-export.xlsx',
      'xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    const result = await validateCSVColumns(file, 'product-catalog');

    expect(result.isValid).toBe(true);
    expect(result.foundColumns).toEqual({
      sku: 'Item Code',
      name: 'Item Description',
      cost: 'Cost Ex',
      barcode: 'Barcode',
    });
  });

  it('accepts XLS product catalog headers from FRED exports', async () => {
    const file = createWorkbookFile('fred-export.xls', 'xls', 'application/vnd.ms-excel');

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
