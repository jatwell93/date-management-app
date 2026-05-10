import fs from 'fs';
import * as path from 'path';

export const PRODUCT_IMPORT_COLUMN_ALTERNATIVES = {
  sku: ['SKU', 'Item Code', 'Reorder Number', 'Product Code', 'Item Number'],
  name: ['Name', 'Item Description', 'Product Name', 'Description', 'Item Name'],
  cost: [
    'Cost',
    'Cost Price',
    'Unit Cost',
    'Cost ex',
    'Price',
    'Unit Price',
    'Cost inc',
    'Selling Price',
    'Retail Price',
  ],
  barcode: ['Barcode', 'Alias', 'EAN', 'UPC', 'GTIN', 'Product Barcode', 'Barcode Number'],
} as const;

export interface ProductImportCsvColumnState {
  skuHeader: string | null;
  nameHeader: string | null;
  costHeader: string | null;
  barcodeHeader: string | null;
}

export interface ProductImportXlsxColumnState {
  skuColIndex: number | null;
  nameColIndex: number | null;
  costColIndex: number | null;
  barcodeColIndex: number | null;
}

export interface ProductImportRowValues {
  sku: string | null;
  name: string | null;
  costStr: string | null;
  barcode: string | null;
}

function normalizeCellValue(value: unknown): string | null {
  return value !== undefined && value !== null ? value.toString().trim() : null;
}

function readRowValue(
  row: unknown[] | Record<string, unknown>,
  key: string | number | null,
): string | null {
  if (key === null) return null;
  if (Array.isArray(row)) return typeof key === 'number' ? normalizeCellValue(row[key]) : null;
  return typeof key === 'string' ? normalizeCellValue(row[key]) : null;
}

function getAllowedProductImportHeaderValues(): string[] {
  return [
    ...PRODUCT_IMPORT_COLUMN_ALTERNATIVES.sku,
    ...PRODUCT_IMPORT_COLUMN_ALTERNATIVES.name,
    ...PRODUCT_IMPORT_COLUMN_ALTERNATIVES.cost,
    ...PRODUCT_IMPORT_COLUMN_ALTERNATIVES.barcode,
  ].map((header) => header.toLowerCase());
}

function getAllowedProductImportHeadersFromCsvState(
  state: ProductImportCsvColumnState,
): Set<string> {
  return new Set(
    [
      state.skuHeader,
      state.nameHeader,
      state.costHeader,
      state.barcodeHeader,
      ...getAllowedProductImportHeaderValues(),
    ]
      .filter((header): header is string => Boolean(header))
      .map((header) => header.toLowerCase()),
  );
}

function getAllowedProductImportHeadersFromXlsxState(
  headers: (string | null | undefined)[],
  state: ProductImportXlsxColumnState,
): Set<string> {
  return new Set(
    [
      state.skuColIndex !== null ? headers[state.skuColIndex] : null,
      state.nameColIndex !== null ? headers[state.nameColIndex] : null,
      state.costColIndex !== null ? headers[state.costColIndex] : null,
      state.barcodeColIndex !== null ? headers[state.barcodeColIndex] : null,
      ...getAllowedProductImportHeaderValues(),
    ]
      .filter((header): header is string => Boolean(header))
      .map((header) => header.toLowerCase()),
  );
}

export async function detectProductImportFileType(
  filePath: string,
  originalFilename?: string,
): Promise<'csv' | 'xls' | 'xlsx'> {
  if (originalFilename) {
    const ext = path.extname(originalFilename).toLowerCase();
    if (ext === '.xlsx') return 'xlsx';
    if (ext === '.xls') return 'xls';
  }

  const pathExt = path.extname(filePath).toLowerCase();
  if (pathExt === '.xlsx') return 'xlsx';
  if (pathExt === '.xls') return 'xls';

  try {
    const fileHandle = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(4);
    await fileHandle.read(buffer, 0, buffer.length, 0);
    await fileHandle.close();

    const header = buffer.toString('binary');
    if (header.startsWith('PK')) {
      return 'xlsx';
    }
  } catch (error) {
    console.error('Error reading file header for type detection:', error);
  }

  return 'csv';
}

export function findColumnByAlternatives(
  row: Record<string, unknown>,
  alternatives: string[],
): string | null {
  const headers = Object.keys(row);

  for (const alt of alternatives) {
    const foundHeader = headers.find((header) => header.toLowerCase() === alt.toLowerCase());
    if (foundHeader) {
      return foundHeader;
    }
  }

  return null;
}

export function findColumnIndexByAlternatives(
  headers: (string | null | undefined)[],
  alternatives: string[],
): number | null {
  const normalizedAlternatives = new Set(alternatives.map((alt) => alt.toLowerCase()));
  const columnIndex = headers.findIndex((header) =>
    header ? normalizedAlternatives.has(header.toString().trim().toLowerCase()) : false,
  );

  return columnIndex === -1 ? null : columnIndex;
}

export function getProductImportCsvColumnState(
  row: Record<string, unknown>,
): ProductImportCsvColumnState {
  return {
    skuHeader: findColumnByAlternatives(row, [...PRODUCT_IMPORT_COLUMN_ALTERNATIVES.sku]),
    nameHeader: findColumnByAlternatives(row, [...PRODUCT_IMPORT_COLUMN_ALTERNATIVES.name]),
    costHeader: findColumnByAlternatives(row, [...PRODUCT_IMPORT_COLUMN_ALTERNATIVES.cost]),
    barcodeHeader: findColumnByAlternatives(row, [...PRODUCT_IMPORT_COLUMN_ALTERNATIVES.barcode]),
  };
}

export function getProductImportXlsxColumnState(
  headers: (string | null | undefined)[],
): ProductImportXlsxColumnState {
  return {
    skuColIndex: findColumnIndexByAlternatives(headers, [
      ...PRODUCT_IMPORT_COLUMN_ALTERNATIVES.sku,
    ]),
    nameColIndex: findColumnIndexByAlternatives(headers, [
      ...PRODUCT_IMPORT_COLUMN_ALTERNATIVES.name,
    ]),
    costColIndex: findColumnIndexByAlternatives(headers, [
      ...PRODUCT_IMPORT_COLUMN_ALTERNATIVES.cost,
    ]),
    barcodeColIndex: findColumnIndexByAlternatives(headers, [
      ...PRODUCT_IMPORT_COLUMN_ALTERNATIVES.barcode,
    ]),
  };
}

export function getProductImportCsvRowValues(
  row: Record<string, unknown>,
  state: ProductImportCsvColumnState,
): ProductImportRowValues {
  return getProductImportRowValues(row, {
    sku: state.skuHeader,
    name: state.nameHeader,
    costStr: state.costHeader,
    barcode: state.barcodeHeader,
  });
}

export function getProductImportXlsxRowValues(
  row: unknown[],
  state: ProductImportXlsxColumnState,
): ProductImportRowValues {
  return getProductImportRowValues(row, {
    sku: state.skuColIndex,
    name: state.nameColIndex,
    costStr: state.costColIndex,
    barcode: state.barcodeColIndex,
  });
}

function getProductImportRowValues(
  row: unknown[] | Record<string, unknown>,
  keys: Record<keyof ProductImportRowValues, string | number | null>,
): ProductImportRowValues {
  return {
    sku: readRowValue(row, keys.sku),
    name: readRowValue(row, keys.name),
    costStr: readRowValue(row, keys.costStr),
    barcode: readRowValue(row, keys.barcode),
  };
}

export function getProductImportCsvUnexpectedColumns(
  row: Record<string, unknown>,
  state: ProductImportCsvColumnState,
): string[] {
  const allowedColumns = getAllowedProductImportHeadersFromCsvState(state);
  return Object.keys(row).filter((column) => !allowedColumns.has(column.toLowerCase()));
}

export function getProductImportXlsxUnexpectedColumns(
  headers: (string | null | undefined)[],
  state: ProductImportXlsxColumnState,
): string[] {
  const allowedColumns = getAllowedProductImportHeadersFromXlsxState(headers, state);
  return headers
    .filter((header): header is string => Boolean(header))
    .filter((header) => !allowedColumns.has(header.toLowerCase()));
}
