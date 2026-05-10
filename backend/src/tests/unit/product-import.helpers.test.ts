import {
  detectProductImportFileType,
  getProductImportCsvColumnState,
  getProductImportCsvRowValues,
  getProductImportCsvUnexpectedColumns,
  getProductImportXlsxColumnState,
  getProductImportXlsxRowValues,
  getProductImportXlsxUnexpectedColumns,
  findColumnByAlternatives,
  findColumnIndexByAlternatives,
} from '../../services/product-import.helpers';

describe('product-import helpers', () => {
  describe('detectProductImportFileType', () => {
    it('prefers filename extension over path when present', async () => {
      const result = await detectProductImportFileType('/tmp/upload-no-ext', 'products.xlsx');

      expect(result).toBe('xlsx');
    });

    it('falls back to csv when the file header is not a zip archive', async () => {
      const result = await detectProductImportFileType('package.json');

      expect(result).toBe('csv');
    });
  });

  describe('column matching helpers', () => {
    it('finds matching header names case-insensitively', () => {
      const row = { sku: 'SKU123', name: 'Product', cost: '10.00', barcode: '123456' };

      expect(findColumnByAlternatives(row, ['SKU'])).toBe('sku');
      expect(findColumnByAlternatives(row, ['Name'])).toBe('name');
    });

    it('finds matching header indexes by alternatives', () => {
      const headers = ['SKU', 'Product Name', 'Cost', 'GTIN'];

      expect(findColumnIndexByAlternatives(headers, ['SKU'])).toBe(0);
      expect(findColumnIndexByAlternatives(headers, ['Product Name'])).toBe(1);
      expect(findColumnIndexByAlternatives(headers, ['Barcode', 'GTIN'])).toBe(3);
    });

    it('resolves CSV row state and unexpected columns', () => {
      const row = {
        'Item Code': 'SKU123',
        'Product Name': 'Product',
        'Unit Price': '10.00',
        GTIN: '123456',
        Extra: 'unexpected',
      };

      const state = getProductImportCsvColumnState(row);

      expect(state).toEqual({
        skuHeader: 'Item Code',
        nameHeader: 'Product Name',
        costHeader: 'Unit Price',
        barcodeHeader: 'GTIN',
      });
      expect(getProductImportCsvRowValues(row, state)).toEqual({
        sku: 'SKU123',
        name: 'Product',
        costStr: '10.00',
        barcode: '123456',
      });
      expect(getProductImportCsvUnexpectedColumns(row, state)).toEqual(['Extra']);
    });

    it('resolves XLSX row state and unexpected columns', () => {
      const headers = ['SKU', 'Product Name', 'Unit Price', 'GTIN', 'Extra'];
      const row = ['SKU123', 'Product', '10.00', '123456', 'unexpected'];

      const state = getProductImportXlsxColumnState(headers);

      expect(state).toEqual({
        skuColIndex: 0,
        nameColIndex: 1,
        costColIndex: 2,
        barcodeColIndex: 3,
      });
      expect(getProductImportXlsxRowValues(row, state)).toEqual({
        sku: 'SKU123',
        name: 'Product',
        costStr: '10.00',
        barcode: '123456',
      });
      expect(getProductImportXlsxUnexpectedColumns(headers, state)).toEqual(['Extra']);
    });
  });
});
