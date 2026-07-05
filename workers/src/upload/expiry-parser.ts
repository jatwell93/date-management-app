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

export function validateExpiryRecords(records: string[][]): {
  rows: ValidatedExpiryRow[];
  rowErrors: string[];
  fatalErrors: string[];
  totalRows: number;
} {
  const fatalErrors: string[] = [];
  const rowErrors: string[] = [];
  if (records.length < 2) {
    return { rows: [], rowErrors, fatalErrors: ['No expiry rows found'], totalRows: 0 };
  }

  const headers = records[0].map(normalizeHeader);
  const indexes = {
    sku: findHeaderIndex(headers, EXPIRY_HEADER_ALIASES.sku),
    itemDescription: findHeaderIndex(headers, EXPIRY_HEADER_ALIASES.itemDescription),
    usedByDate: findHeaderIndex(headers, EXPIRY_HEADER_ALIASES.usedByDate),
    department: findHeaderIndex(headers, EXPIRY_HEADER_ALIASES.department),
  };

  // Only SKU and Used-By Date are required; item description and department are optional.
  const missing = (['sku', 'usedByDate'] as const).filter((key) => indexes[key] < 0);
  if (missing.length > 0) {
    return {
      rows: [],
      rowErrors,
      fatalErrors: [`Missing required column header(s): ${missing.join(', ')}`],
      totalRows: 0,
    };
  }

  const rows: ValidatedExpiryRow[] = [];
  let totalRows = 0;
  records.slice(1).forEach((record, index) => {
    if (!record.some((cell) => cell.trim())) return;
    totalRows += 1;
    const rowNumber = index + 2;

    const sku = (record[indexes.sku] || '').trim();
    const usedByInput = (record[indexes.usedByDate] || '').trim();
    const itemDescription =
      indexes.itemDescription >= 0 ? (record[indexes.itemDescription] || '').trim() : '';
    const departmentRaw =
      indexes.department >= 0 ? (record[indexes.department] || '').trim() : '';

    if (!sku) {
      rowErrors.push(`Row ${rowNumber}: SKU is required and cannot be empty`);
      return;
    }
    if (!usedByInput) {
      rowErrors.push(`Row ${rowNumber}: Used-By Date is required and cannot be empty`);
      return;
    }

    const parsedDate = parseExpiryImportDate(usedByInput);
    if (!parsedDate.ok || !parsedDate.isoDate) {
      rowErrors.push(`Row ${rowNumber}: ${parsedDate.errorMessage} ("${usedByInput}")`);
      return;
    }

    rows.push({
      sku,
      itemDescription,
      usedByDate: parsedDate.isoDate,
      department: departmentRaw !== '' ? departmentRaw : undefined,
      rowNumber,
    });
  });

  return { rows, rowErrors, fatalErrors, totalRows };
}
