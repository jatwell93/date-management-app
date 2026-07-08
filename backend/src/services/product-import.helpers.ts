import fs from 'fs';
import * as path from 'path';

export const PRODUCT_IMPORT_COLUMN_ALTERNATIVES = {
  sku: ['SKU', 'Item Code', 'Reorder Number', 'Product Code', 'Item Number'],
  name: ['Name', 'Item Description', 'Product Name', 'Description', 'Item Name'],
  cost: [
    'Cost',
    'Cost Price',
    'Unit Cost',
    'Item Cost',
    'Cost ex',
    'Price',
    'Unit Price',
    'Cost inc',
  ],
  // Retail/selling price, captured distinct from cost so a markdown band can be
  // taken off retail (issue #338). Optional — cost-only files stay valid, so this
  // group is deliberately excluded from the required-column check.
  retail: ['Retail Price', 'Selling Price', 'Sell Price', 'RRP', 'Sale Price'],
  barcode: ['Barcode', 'Alias', 'EAN', 'UPC', 'GTIN', 'Product Barcode', 'Barcode Number'],
} as const;

export interface ProductImportCsvColumnState {
  skuHeader: string | null;
  nameHeader: string | null;
  costHeader: string | null;
  retailHeader: string | null;
  barcodeHeader: string | null;
}

export interface ProductImportXlsxColumnState {
  skuColIndex: number | null;
  nameColIndex: number | null;
  costColIndex: number | null;
  retailColIndex: number | null;
  barcodeColIndex: number | null;
}

export interface ProductImportRowValues {
  sku: string | null | undefined;
  name: string | null | undefined;
  costStr: string | null | undefined;
  retailStr: string | null | undefined;
  barcode: string | null | undefined;
}

export interface ValidProductImportRow {
  sku: string;
  name: string;
  costStr: string;
  barcode: string;
  cost: number;
  // Optional: null when no retail column is present or the cell is blank/unparseable.
  retail: number | null;
}

export type ProductImportRowValidationResult =
  | {
      isValid: true;
      errors: [];
      row: ValidProductImportRow;
    }
  | {
      isValid: false;
      errors: string[];
    };

export interface ProductImportLookupProduct {
  id: number;
  sku: string;
  barcode: string;
}

export type ProductImportOperation<TProduct extends ProductImportLookupProduct> =
  | { type: 'create' }
  | { type: 'update'; product: TProduct }
  | { type: 'conflict'; error: string };

export interface ProductImportOperationInput<TProduct extends ProductImportLookupProduct> {
  sku: string;
  barcode: string;
  bySku: TProduct | null;
  byBarcode: TProduct | null;
}

interface CostTextState {
  text: string;
  isNegative: boolean;
}

type ProductImportFieldName = 'SKU' | 'Name' | 'Cost' | 'Barcode';

interface ProductImportRequiredField {
  field: ProductImportFieldName;
  value: string | null;
  missingMessage: string;
}

interface RequiredProductImportValues {
  sku: string;
  name: string;
  costStr: string;
  barcode: string;
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
    ...PRODUCT_IMPORT_COLUMN_ALTERNATIVES.retail,
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
      state.retailHeader,
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
      state.retailColIndex !== null ? headers[state.retailColIndex] : null,
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
    retailHeader: findColumnByAlternatives(row, [...PRODUCT_IMPORT_COLUMN_ALTERNATIVES.retail]),
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
    retailColIndex: findColumnIndexByAlternatives(headers, [
      ...PRODUCT_IMPORT_COLUMN_ALTERNATIVES.retail,
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
    retailStr: state.retailHeader,
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
    retailStr: state.retailColIndex,
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
    retailStr: readRowValue(row, keys.retailStr),
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

export function parseProductImportCost(costStr: string): number | null {
  const prepared = prepareCostText(costStr);
  const normalized = collapseExtraDecimalPoints(
    stripNonNumericCostCharacters(normalizeCostSeparators(prepared.text)),
  );
  return parsePreparedCostValue(normalized, prepared.isNegative);
}

function prepareCostText(costStr: string): CostTextState {
  return extractLeadingNegative(stripCurrencyText(extractParenthesizedNegative(costStr.trim())));
}

function extractParenthesizedNegative(text: string): CostTextState {
  const openParenIndex = text.lastIndexOf('(');
  const closeParenIndex = text.indexOf(')', openParenIndex);

  if (openParenIndex === -1) {
    return { text, isNegative: false };
  }

  if (closeParenIndex <= openParenIndex) {
    return { text, isNegative: false };
  }

  const insideParen = text.substring(openParenIndex + 1, closeParenIndex);
  return {
    text: text.substring(0, openParenIndex) + insideParen + text.substring(closeParenIndex + 1),
    isNegative: true,
  };
}

function stripCurrencyText(state: CostTextState): CostTextState {
  return {
    text: state.text
      .replace(/([A-Z]{3,4}[\s]*)|([\s]*[A-Z]{3,4})|[\s$€£¥₹₽₪₨₩₦₡₫Є₴₵₸₺₼₾₯]/gi, '')
      .trim()
      .replace(/\s+/g, ''),
    isNegative: state.isNegative,
  };
}

function extractLeadingNegative(state: CostTextState): CostTextState {
  if (!state.text.startsWith('-')) {
    return state;
  }

  return { text: state.text.substring(1), isNegative: true };
}

function normalizeCostSeparators(text: string): string {
  const dotCount = countOccurrences(text, '.');
  const commaCount = countOccurrences(text, ',');

  if (dotCount > 1 && commaCount === 0) {
    return normalizeMultipleDots(text);
  }

  if (commaCount > 1 && dotCount === 0) {
    return text.replace(/,/g, '');
  }

  if (dotCount === 0 && commaCount === 1) {
    return normalizeSingleComma(text);
  }

  if (dotCount > 0 && commaCount > 0) {
    return normalizeMixedSeparators(text);
  }

  return text;
}

function countOccurrences(text: string, character: string): number {
  return (text.match(new RegExp(`\\${character}`, 'g')) || []).length;
}

function normalizeMultipleDots(text: string): string {
  const lastDotIndex = text.lastIndexOf('.');
  const afterLastDot = text.substring(lastDotIndex + 1);

  if (afterLastDot.length !== 2) {
    return text.replace(/\./g, '');
  }

  const integerPart = text.substring(0, lastDotIndex).replace(/\./g, '');
  return integerPart + '.' + afterLastDot;
}

function normalizeSingleComma(text: string): string {
  const commaIndex = text.lastIndexOf(',');
  const afterComma = text.substring(commaIndex + 1);

  if (/^\d{1,3}$/.test(afterComma)) {
    return text.replace(',', '.');
  }

  return text.replace(/,/g, '');
}

function normalizeMixedSeparators(text: string): string {
  const lastDotIndex = text.lastIndexOf('.');
  const lastCommaIndex = text.lastIndexOf(',');

  if (lastDotIndex > lastCommaIndex) {
    return buildDecimalString(text, lastDotIndex, /,/g);
  }

  return buildDecimalString(text, lastCommaIndex, /\./g);
}

function buildDecimalString(
  text: string,
  separatorIndex: number,
  thousandsPattern: RegExp,
): string {
  const integerPart = text.substring(0, separatorIndex).replace(thousandsPattern, '');
  const decimalPart = text.substring(separatorIndex + 1);
  return integerPart + '.' + decimalPart;
}

function stripNonNumericCostCharacters(text: string): string {
  if (text.match(/^[0-9]+[,.][0-9]{3}$/)) {
    return text.replace(/[,.]/, '').replace(/[^\d.]/g, '');
  }

  return text.replace(/[^\d.]/g, '');
}

function collapseExtraDecimalPoints(text: string): string {
  const parts = text.split('.');

  if (parts.length <= 2) {
    return text;
  }

  const integerPart = parts.slice(0, -1).join('');
  const decimalPart = parts[parts.length - 1];
  return integerPart + '.' + decimalPart;
}

function parsePreparedCostValue(normalizedText: string, isNegative: boolean): number | null {
  const value = parseFloat(normalizedText);

  if (Number.isNaN(value)) {
    return null;
  }

  return isNegative ? -value : value;
}

export function validateProductImportRow({
  rowNumber,
  values,
  unexpectedColumns,
}: {
  rowNumber: number;
  values: ProductImportRowValues;
  unexpectedColumns: string[];
}): ProductImportRowValidationResult {
  const sku = values.sku?.trim() || null;
  const name = values.name?.trim() || null;
  const costStr = values.costStr?.trim() || null;
  const retailStr = values.retailStr?.trim() || null;
  const barcode = values.barcode?.trim() || null;
  const requiredFields = getProductImportRequiredFields({ sku, name, costStr, barcode });
  const errors = getMissingRequiredFieldErrors(rowNumber, requiredFields);
  const requiredValues = toRequiredProductImportValues({ sku, name, costStr, barcode });

  if (!requiredValues) {
    return { isValid: false, errors };
  }

  const cost = parseProductImportCost(requiredValues.costStr);
  errors.push(...getCostValidationErrors(rowNumber, requiredValues.costStr, cost));
  errors.push(...getProductImportLengthErrors(rowNumber, requiredValues));
  errors.push(...getUnexpectedColumnErrors(rowNumber, unexpectedColumns));

  if (errors.length > 0 || cost === null) {
    return { isValid: false, errors };
  }

  // Retail is optional: a missing column, blank cell, or unparseable value is not
  // an error — it simply leaves the product without a retail price (falls back to
  // cost for retail-basis markdown bands). Mirrors the workers catalogue parser.
  const retail = retailStr === null ? null : parseProductImportCost(retailStr);

  return {
    isValid: true,
    errors: [],
    row: {
      sku: requiredValues.sku,
      name: requiredValues.name,
      costStr: requiredValues.costStr,
      barcode: requiredValues.barcode,
      cost,
      retail,
    },
  };
}

function toRequiredProductImportValues(values: {
  sku: string | null;
  name: string | null;
  costStr: string | null;
  barcode: string | null;
}): RequiredProductImportValues | null {
  if (hasMissingRequiredFields(getProductImportRequiredFields(values))) {
    return null;
  }

  return values as RequiredProductImportValues;
}

function getProductImportRequiredFields({
  sku,
  name,
  costStr,
  barcode,
}: {
  sku: string | null;
  name: string | null;
  costStr: string | null;
  barcode: string | null;
}): ProductImportRequiredField[] {
  return [
    {
      field: 'SKU',
      value: sku,
      missingMessage: 'Please ensure the column exists and contains a value.',
    },
    {
      field: 'Name',
      value: name,
      missingMessage: 'Please ensure the column exists and contains a value.',
    },
    {
      field: 'Cost',
      value: costStr,
      missingMessage:
        "Please ensure the column exists and contains a numeric value (e.g., '12.99', '$12.99', or 'EUR 12.99').",
    },
    {
      field: 'Barcode',
      value: barcode,
      missingMessage: 'Please ensure the column exists and contains a value.',
    },
  ];
}

function getMissingRequiredFieldErrors(
  rowNumber: number,
  fields: ProductImportRequiredField[],
): string[] {
  return fields
    .filter((field) => !field.value)
    .map(
      (field) =>
        `Row ${rowNumber}: Missing required field - ${field.field}. ${field.missingMessage}`,
    );
}

function hasMissingRequiredFields(fields: ProductImportRequiredField[]): boolean {
  return fields.some((field) => !field.value);
}

function getCostValidationErrors(
  rowNumber: number,
  costStr: string,
  cost: number | null,
): string[] {
  if (cost !== null) {
    return [];
  }

  return [
    `Row ${rowNumber}: Invalid cost value - "${costStr}". Cost can be a positive or negative number. Acceptable formats include: '12.99', '$12.99', '€15.50', '(10.99)' for negative values, '1,234.56', '1.234,56' (European format).`,
  ];
}

function getProductImportLengthErrors(
  rowNumber: number,
  values: { sku: string; name: string; barcode: string },
): string[] {
  return [
    getMaxLengthError(rowNumber, 'SKU', values.sku, 100),
    getMaxLengthError(rowNumber, 'Name', values.name, 200),
    getMaxLengthError(rowNumber, 'Barcode', values.barcode, 100),
  ].filter((error): error is string => Boolean(error));
}

function getMaxLengthError(
  rowNumber: number,
  field: 'SKU' | 'Name' | 'Barcode',
  value: string,
  maxLength: number,
): string | null {
  if (value.length <= maxLength) {
    return null;
  }

  return `Row ${rowNumber}: ${field} too long (max ${maxLength} characters) - "${value.substring(0, 50)}...". Please ensure the ${field} value is ${maxLength} characters or fewer.`;
}

function getUnexpectedColumnErrors(rowNumber: number, unexpectedColumns: string[]): string[] {
  if (unexpectedColumns.length === 0) {
    return [];
  }

  return [`Row ${rowNumber}: Unexpected columns found - ${unexpectedColumns.join(', ')}`];
}

export function resolveProductImportOperation<TProduct extends ProductImportLookupProduct>({
  sku,
  barcode,
  bySku,
  byBarcode,
}: ProductImportOperationInput<TProduct>): ProductImportOperation<TProduct> {
  const conflict = getProductImportIdentifierConflict({ sku, barcode, bySku, byBarcode });

  if (conflict) {
    return {
      type: 'conflict',
      error: conflict,
    };
  }

  const product = bySku ?? byBarcode;

  if (product) {
    return { type: 'update', product };
  }

  return { type: 'create' };
}

function getProductImportIdentifierConflict<TProduct extends ProductImportLookupProduct>({
  sku,
  barcode,
  bySku,
  byBarcode,
}: ProductImportOperationInput<TProduct>): string | null {
  if (!bySku) {
    return null;
  }

  if (!byBarcode) {
    return null;
  }

  if (bySku.id === byBarcode.id) {
    return null;
  }

  return `Duplicate identifiers detected: SKU ${sku} exists in product ${bySku.id} and barcode ${barcode} exists in product ${byBarcode.id}. This will cause data integrity issues.`;
}
