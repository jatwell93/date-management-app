/**
 * CSV Validation Utilities
 *
 * Pre-upload validation to provide better user feedback before processing
 */

// Column name alternatives matching backend COLUMN_ALTERNATIVES
const REQUIRED_COLUMNS = {
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

export interface ColumnValidationResult {
  isValid: boolean;
  missingColumns: string[];
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

/**
 * Validate that all required columns are present in CSV headers
 */
export async function validateCSVColumns(file: File): Promise<ColumnValidationResult> {
  const headers = await readCSVHeaders(file);
  const headersLower = headers.map((h) => h.toLowerCase());

  const result: ColumnValidationResult = {
    isValid: true,
    missingColumns: [],
    foundColumns: {},
    suggestions: {},
  };

  // Check each required field
  for (const [fieldName, alternatives] of Object.entries(REQUIRED_COLUMNS)) {
    let found = false;

    for (const alt of alternatives) {
      const altLower = alt.toLowerCase();
      const matchIndex = headersLower.indexOf(altLower);

      if (matchIndex !== -1) {
        result.foundColumns[fieldName] = headers[matchIndex];
        found = true;
        break;
      }
    }

    if (!found) {
      result.isValid = false;
      result.missingColumns.push(fieldName);

      // Suggest close matches (simple fuzzy match)
      const suggestions = headers.filter(
        (h) => h.toLowerCase().includes(fieldName) || fieldName.includes(h.toLowerCase()),
      );

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

  const messages: string[] = [];

  for (const missingField of validation.missingColumns) {
    const expectedNames = REQUIRED_COLUMNS[missingField as keyof typeof REQUIRED_COLUMNS]
      .slice(0, 3)
      .join(', ');

    let msg = `Missing required column: "${missingField.toUpperCase()}". Expected one of: ${expectedNames}`;

    if (validation.suggestions[missingField]?.length) {
      msg += `. Did you mean: ${validation.suggestions[missingField].join(' or ')}?`;
    }

    messages.push(msg);
  }

  return messages.join('\n\n');
}
