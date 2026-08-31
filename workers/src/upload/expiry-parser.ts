import { escapeSpreadsheetFormula } from '../../../shared/domain/csv-injection';
import { findHeaderIndex, normalizeHeader } from './catalogue-parser';
import { parseExpiryImportDate } from './expiry-date-parser';

export type ExpiryImportRow = {
  sku: string;
  itemDescription: string;
  /** Normalized to an ISO `YYYY-MM-DD` calendar date. */
  usedByDate: string;
  /** Department name; undefined when the column is absent or blank. */
  department?: string;
};

export type ValidatedExpiryRow = ExpiryImportRow & { rowNumber: number };

/**
 * Accepted header names per field. Kept in sync with the Express backend's
 * EXPIRY_COLUMN_ALTERNATIVES (backend/src/services/csv-parser.service.ts) and the
 * frontend EXPIRY_REQUIRED_COLUMNS (frontend/src/utils/csvValidator.ts). Matching
 * is case/format-insensitive via normalizeHeader, so entries here are the raw
 * human-readable variants.
 */
export const EXPIRY_HEADER_ALIASES = {
  sku: ['sku', 'itemcode', 'reordernumber', 'productcode', 'itemnumber'],
  itemDescription: ['name', 'itemdescription', 'productname', 'description', 'itemname'],
  usedByDate: [
    'usedbydate',
    'usedby',
    'usebydate',
    'useby',
    'expirydate',
    'expiry',
    'bestbefore',
  ],
  department: ['department', 'dept', 'location', 'storearea', 'area', 'section'],
} as const;

type ExpiryHeaderIndexes = {
  sku: number;
  itemDescription: number;
  usedByDate: number;
  department: number;
};

type ExpiryValidationResult = {
  rows: ValidatedExpiryRow[];
  rowErrors: string[];
  fatalErrors: string[];
  totalRows: number;
};

function emptyValidationResult(fatalErrors: string[] = []): ExpiryValidationResult {
  return { rows: [], rowErrors: [], fatalErrors, totalRows: 0 };
}

function findExpiryHeaderIndexes(headers: string[]): ExpiryHeaderIndexes {
  return {
    sku: findHeaderIndex(headers, EXPIRY_HEADER_ALIASES.sku),
    itemDescription: findHeaderIndex(headers, EXPIRY_HEADER_ALIASES.itemDescription),
    usedByDate: findHeaderIndex(headers, EXPIRY_HEADER_ALIASES.usedByDate),
    department: findHeaderIndex(headers, EXPIRY_HEADER_ALIASES.department),
  };
}

function missingRequiredHeaders(indexes: ExpiryHeaderIndexes): Array<'sku' | 'usedByDate'> {
  return (['sku', 'usedByDate'] as const).filter((key) => indexes[key] < 0);
}

function isBlankRecord(record: string[]): boolean {
  return !record.some((cell) => cell.trim());
}

function cellValue(record: string[], index: number): string {
  return index >= 0 ? (record[index] || '').trim() : '';
}

/**
 * Trimmed cell text, escaped against spreadsheet-formula injection (#473).
 *
 * The expiry import persists sku, itemDescription and department as product and
 * store-area names — the same three fields Express escapes in
 * validateExpiryRowStrictly. The used-by date deliberately does not go through
 * here: it is parsed into an ISO date rather than stored as the file's text.
 */
function freeTextCellValue(record: string[], index: number): string {
  return escapeSpreadsheetFormula(cellValue(record, index));
}

function validateExpiryRecord(
  record: string[],
  rowNumber: number,
  indexes: ExpiryHeaderIndexes,
): { row?: ValidatedExpiryRow; error?: string } {
  const sku = freeTextCellValue(record, indexes.sku);
  const usedByInput = cellValue(record, indexes.usedByDate);
  const itemDescription = freeTextCellValue(record, indexes.itemDescription);
  const departmentRaw = freeTextCellValue(record, indexes.department);

  if (!sku) {
    return { error: `Row ${rowNumber}: SKU is required and cannot be empty` };
  }
  if (!usedByInput) {
    return { error: `Row ${rowNumber}: Used-By Date is required and cannot be empty` };
  }

  const parsedDate = parseExpiryImportDate(usedByInput);
  if (!parsedDate.ok || !parsedDate.isoDate) {
    return { error: `Row ${rowNumber}: ${parsedDate.errorMessage} ("${usedByInput}")` };
  }

  return {
    row: {
      sku,
      itemDescription,
      usedByDate: parsedDate.isoDate,
      department: departmentRaw !== '' ? departmentRaw : undefined,
      rowNumber,
    },
  };
}

export function validateExpiryRecords(records: string[][]): {
  rows: ValidatedExpiryRow[];
  rowErrors: string[];
  fatalErrors: string[];
  totalRows: number;
} {
  if (records.length < 2) {
    return emptyValidationResult(['No expiry rows found']);
  }

  const headers = records[0].map(normalizeHeader);
  const indexes = findExpiryHeaderIndexes(headers);

  // Only SKU and Used-By Date are required; item description and department are optional.
  const missing = missingRequiredHeaders(indexes);
  if (missing.length > 0) {
    return emptyValidationResult([`Missing required column header(s): ${missing.join(', ')}`]);
  }

  const rows: ValidatedExpiryRow[] = [];
  const rowErrors: string[] = [];
  let totalRows = 0;
  records.slice(1).forEach((record, index) => {
    if (isBlankRecord(record)) return;
    totalRows += 1;
    const validated = validateExpiryRecord(record, index + 2, indexes);
    if (validated.error) rowErrors.push(validated.error);
    if (validated.row) rows.push(validated.row);
  });

  return { rows, rowErrors, fatalErrors: [], totalRows };
}
