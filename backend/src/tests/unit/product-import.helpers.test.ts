import {
  detectProductImportFileType,
  getProductImportCsvColumnState,
  getProductImportCsvRowValues,
  getProductImportCsvUnexpectedColumns,
  getProductImportXlsxColumnState,
  getProductImportXlsxRowValues,
  getProductImportXlsxUnexpectedColumns,
  resolveProductImportOperation,
  validateProductImportRow,
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

  describe('row validation helpers', () => {
    it('returns row-scoped errors for missing required values', () => {
      const result = validateProductImportRow({
        rowNumber: 7,
        values: {
          sku: '',
          name: null,
          costStr: undefined,
          barcode: '',
        },
        unexpectedColumns: [],
      });

      expect(result).toEqual({
        isValid: false,
        errors: [
          'Row 7: Missing required field - SKU. Please ensure the column exists and contains a value.',
          'Row 7: Missing required field - Name. Please ensure the column exists and contains a value.',
          "Row 7: Missing required field - Cost. Please ensure the column exists and contains a numeric value (e.g., '12.99', '$12.99', or 'EUR 12.99').",
          'Row 7: Missing required field - Barcode. Please ensure the column exists and contains a value.',
        ],
      });
    });

    it('returns a normalized row when all values are valid', () => {
      const result = validateProductImportRow({
        rowNumber: 3,
        values: {
          sku: ' SKU-1 ',
          name: ' Product 1 ',
          costStr: ' $1,234.50 ',
          barcode: ' BAR-1 ',
        },
        unexpectedColumns: [],
      });

      expect(result).toEqual({
        isValid: true,
        errors: [],
        row: {
          sku: 'SKU-1',
          name: 'Product 1',
          costStr: '$1,234.50',
          barcode: 'BAR-1',
          cost: 1234.5,
        },
      });
    });

    it('returns validation errors for invalid cost, length limits, and unexpected columns', () => {
      const result = validateProductImportRow({
        rowNumber: 12,
        values: {
          sku: 'S'.repeat(101),
          name: 'N'.repeat(201),
          costStr: 'not-a-cost',
          barcode: 'B'.repeat(101),
        },
        unexpectedColumns: ['Legacy Notes'],
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual([
        "Row 12: Invalid cost value - \"not-a-cost\". Cost can be a positive or negative number. Acceptable formats include: '12.99', '$12.99', '€15.50', '(10.99)' for negative values, '1,234.56', '1.234,56' (European format).",
        `Row 12: SKU too long (max 100 characters) - "${'S'.repeat(50)}...". Please ensure the SKU value is 100 characters or fewer.`,
        `Row 12: Name too long (max 200 characters) - "${'N'.repeat(50)}...". Please ensure the Name value is 200 characters or fewer.`,
        `Row 12: Barcode too long (max 100 characters) - "${'B'.repeat(50)}...". Please ensure the Barcode value is 100 characters or fewer.`,
        'Row 12: Unexpected columns found - Legacy Notes',
      ]);
    });
  });

  describe('operation resolution helpers', () => {
    const existingSkuProduct = {
      id: 10,
      sku: 'SKU-10',
      barcode: 'BAR-10',
    };

    const existingBarcodeProduct = {
      id: 20,
      sku: 'SKU-20',
      barcode: 'BAR-20',
    };

    it('selects update when SKU or barcode map to an existing product', () => {
      expect(
        resolveProductImportOperation({
          sku: 'SKU-10',
          barcode: 'BAR-NEW',
          bySku: existingSkuProduct,
          byBarcode: null,
        }),
      ).toEqual({ type: 'update', product: existingSkuProduct });

      expect(
        resolveProductImportOperation({
          sku: 'SKU-NEW',
          barcode: 'BAR-20',
          bySku: null,
          byBarcode: existingBarcodeProduct,
        }),
      ).toEqual({ type: 'update', product: existingBarcodeProduct });
    });

    it('selects create when neither identifier exists', () => {
      expect(
        resolveProductImportOperation({
          sku: 'SKU-NEW',
          barcode: 'BAR-NEW',
          bySku: null,
          byBarcode: null,
        }),
      ).toEqual({ type: 'create' });
    });

    it('returns a conflict when SKU and barcode identify different products', () => {
      expect(
        resolveProductImportOperation({
          sku: 'SKU-10',
          barcode: 'BAR-20',
          bySku: existingSkuProduct,
          byBarcode: existingBarcodeProduct,
        }),
      ).toEqual({
        type: 'conflict',
        error:
          'Duplicate identifiers detected: SKU SKU-10 exists in product 10 and barcode BAR-20 exists in product 20. This will cause data integrity issues.',
      });
    });
  });
});
