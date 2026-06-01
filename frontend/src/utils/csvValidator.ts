/**
 * CSV Validation Utilities
 *
 * Pre-upload validation to provide better user feedback before processing
 */

import * as XLSX from 'xlsx';

export type UploadImportType = 'product-catalog' | 'expiry-list';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getFileExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

// Column name alternatives matching backend parser contracts
const PRODUCT_REQUIRED_COLUMNS = {
  sku: [
    'SKU',
    'Item Code',
    'Reorder Number',
    'Product Code',
    'Item Number',
    'sku',
    'item_code',
    'product_code',
  ],
  name: [
    'Name',
    'Item Description',
    'Product Name',
    'Description',
    'Item Name',
    'name',
    'description',
    'product_name',
  ],
  cost: [
    'Cost',
    'Cost Ex',
    'Unit Cost',
    'Price',
    'Cost Price',
    'Item Cost',
    'cost',
    'price',
    'unit_cost',
  ],
  barcode: [
    'Barcode',
    'Alias',
    'EAN',
    'UPC',
    'GTIN',
    'Product Barcode',
    'Barcode Number',
    'barcode',
    'alias',
  ],
};

const EXPIRY_REQUIRED_COLUMNS = {
  sku: PRODUCT_REQUIRED_COLUMNS.sku,
  usedByDate: [
    'Used-By Date',
    'Used By Date',
    'Used By',
    'Use By Date',
    'Use By',
    'Expiry Date',
    'Expiry',
    'Best Before',
    'used_by_date',
    'usedbydate',
    'expiry_date',
  ],
};

const REQUIRED_COLUMNS_BY_TYPE: Record<UploadImportType, Record<string, string[]>> = {
  'product-catalog': PRODUCT_REQUIRED_COLUMNS,
  'expiry-list': EXPIRY_REQUIRED_COLUMNS,
};

export interface ColumnValidationResult {
  isValid: boolean;
  missingColumns: string[];
  importType: UploadImportType;
  foundColumns: Record<string, string>; // Maps required field -> actual column name
  suggestions: Record<string, string[]>; // Suggests possible matches for missing columns
}

export interface RowEstimate {
  estimatedRows: number;
  showWarning: boolean;
  warningMessage?: string;
}

/**
 * Read the first line of a file to extract CSV headers
 */
async function readCSVHeaders(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const text = e.target?.result as string;
      // Get first line (or entire text if no newline found)
      const firstLine = text.split('\n')[0];

      // If first line is still at max buffer size and doesn't end with newline,
      // it might be truncated, but we proceed anyway as 8KB is very generous
      const headers = firstLine
        .split(',')
        .map((h) => h.trim().replace(/^"|"$/g, '')) // Remove quotes
        .filter((h) => h.length > 0);
      resolve(headers);
    };

    reader.onerror = () => reject(new Error('Failed to read file headers'));

    // Read first 8KB to get headers (handles long header rows)
    // Most CSV files have headers well under this size
    const blob = file.slice(0, 8192);
    reader.readAsText(blob);
  });
}

async function readSpreadsheetHeaders(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];

        if (!firstSheetName) {
          resolve([]);
          return;
        }

        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
          header: 1,
          blankrows: false,
        });
        const headerRow = rows.find(
          (row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim().length > 0),
        );

        if (!headerRow) {
          resolve([]);
          return;
        }

        resolve(headerRow.map((h) => String(h ?? '').trim()).filter((h) => h.length > 0));
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Failed to read spreadsheet headers'));
      }
    };

    reader.onerror = () => reject(new Error('Failed to read spreadsheet headers'));
    reader.readAsArrayBuffer(file);
  });
}

async function readUploadHeaders(file: File): Promise<string[]> {
  const extension = getFileExtension(file.name);

  if (extension === 'xlsx' || extension === 'xls') {
    return readSpreadsheetHeaders(file);
  }

  return readCSVHeaders(file);
}

/**
 * Validate that all required columns are present in CSV headers
 */
export async function validateCSVColumns(
  file: File,
  importType: UploadImportType = 'product-catalog',
): Promise<ColumnValidationResult> {
  const headers = await readUploadHeaders(file);
  const headersLower = headers.map((h) => h.toLowerCase());
  const requiredColumns = REQUIRED_COLUMNS_BY_TYPE[importType];

  const result: ColumnValidationResult = {
    isValid: true,
    missingColumns: [],
    importType,
    foundColumns: {},
    suggestions: {},
  };
  const headerIndexByName = new Map<string, number>();
  headersLower.forEach((header, index) => {
    if (!headerIndexByName.has(header)) {
      headerIndexByName.set(header, index);
    }
  });

  // Check each required field
  for (const [fieldName, alternatives] of Object.entries(requiredColumns)) {
    let found = false;

    for (const alt of alternatives) {
      const altLower = alt.toLowerCase();
      const matchIndex = headerIndexByName.get(altLower);

      if (matchIndex !== undefined) {
        result.foundColumns[fieldName] = headers[matchIndex];
        found = true;
        break;
      }
    }

    if (!found) {
      result.isValid = false;
      result.missingColumns.push(fieldName);

      // Suggest close matches (simple fuzzy match)
      const fieldNameLower = fieldName.toLowerCase();
      const fieldNamePattern = new RegExp(escapeRegExp(fieldNameLower));
      const suggestions = headers.filter((h) => {
        const headerLower = h.toLowerCase();
        const headerPattern = new RegExp(escapeRegExp(headerLower));
        return fieldNamePattern.test(headerLower) || headerPattern.test(fieldNameLower);
      });

      if (suggestions.length > 0) {
        result.suggestions[fieldName] = suggestions;
      }
    }
  }

  return result;
}

/**
 * Estimate row count from file size
 * Assumes average ~100 bytes per row (rough estimate for typical CSV)
 */
export function estimateRowCount(file: File): RowEstimate {
  const BYTES_PER_ROW_ESTIMATE = 100;
  const WARNING_THRESHOLD = 25000;

  const estimatedRows = Math.floor(file.size / BYTES_PER_ROW_ESTIMATE);

  if (estimatedRows > WARNING_THRESHOLD) {
    return {
      estimatedRows,
      showWarning: true,
      warningMessage: `Large file detected (~${estimatedRows.toLocaleString()} estimated rows). Processing may take 5-10 minutes.`,
    };
  }

  return {
    estimatedRows,
    showWarning: false,
  };
}

/**
 * Generate user-friendly error message for missing columns
 */
export function formatColumnValidationError(validation: ColumnValidationResult): string {
  if (validation.isValid) {
    return '';
  }

  const requiredColumns = REQUIRED_COLUMNS_BY_TYPE[validation.importType];
  const messages: string[] = [];

  for (const missingField of validation.missingColumns) {
    const expectedNames = requiredColumns[missingField].slice(0, 3).join(', ');

    let msg = `Missing required column: "${missingField.toUpperCase()}". Expected one of: ${expectedNames}`;

    if (validation.suggestions[missingField]?.length) {
      msg += `. Did you mean: ${validation.suggestions[missingField].join(' or ')}?`;
    }

    messages.push(msg);
  }

  return messages.join('\n\n');
}
