/**
 * GS1-128 barcode parser for pharmacy applications
 * Parses Application Identifiers (01), (10), (17), (21) commonly used in pharmaceutical barcodes
 */

import { GS1ParseResult } from '../types/handheld';

/**
 * Converts YYMMDD format to ISO date string
 * @param yymmdd - Date in YYMMDD format (e.g., "250315" for March 15, 2025)
 * @returns ISO date string (e.g., "2025-03-15") or null if invalid
 */
function convertYYMMDDToISO(yymmdd: string): string | null {
  if (yymmdd.length !== 6) return null;

  const year = parseInt(yymmdd.substring(0, 2), 10);
  const month = parseInt(yymmdd.substring(2, 4), 10);
  const day = parseInt(yymmdd.substring(4, 6), 10);

  // Validate date components
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Convert 2-digit year to 4-digit (assuming 1950-2049 range)
  const fullYear = year >= 50 ? 1900 + year : 2000 + year;

  // Create date string directly to avoid timezone issues
  const monthStr = month.toString().padStart(2, '0');
  const dayStr = day.toString().padStart(2, '0');

  // Basic validation - check if date would be valid
  const date = new Date(fullYear, month - 1, day);
  if (date.getFullYear() !== fullYear || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null; // Invalid date
  }

  return `${fullYear}-${monthStr}-${dayStr}`;
}

/**
 * Parses a GS1-128 barcode string and extracts relevant pharmacy data
 * @param barcode - The raw barcode string to parse
 * @returns GS1ParseResult with extracted data or fallback to raw barcode
 */
export function parseGS1Barcode(barcode: string): GS1ParseResult {
  const result: GS1ParseResult = {
    raw: barcode,
    isValid: false,
    errors: [],
  };

  if (!barcode || typeof barcode !== 'string') {
    result.errors.push('Invalid barcode: must be a non-empty string');
    return result;
  }

  try {
    // GS1-128 barcodes start with the FNC1 character (represented as ']C1' or group separator)
    // For simplicity, we'll look for AI patterns directly
    let remaining = barcode;

    // Extract GTIN (01) - 14 digits after (01)
    const gtinMatch = remaining.match(/\(01\)(\d{14})/);
    if (gtinMatch) {
      result.gtin = gtinMatch[1];
      remaining = remaining.replace(gtinMatch[0], '');
    }

    // Extract batch/lot number (10) - variable length, up to 20 chars
    const batchMatch = remaining.match(/\(10\)([^()]{1,20})/);
    if (batchMatch) {
      result.batchLot = batchMatch[1].trim();
      remaining = remaining.replace(batchMatch[0], '');
    }

    // Extract expiry date (17) - 6 digits YYMMDD
    const expiryMatch = remaining.match(/\(17\)(\d{6})/);
    if (expiryMatch) {
      const isoDate = convertYYMMDDToISO(expiryMatch[1]);
      if (isoDate) {
        result.expiryDate = isoDate;
      } else {
        result.errors.push(`Invalid expiry date format: ${expiryMatch[1]}`);
      }
      remaining = remaining.replace(expiryMatch[0], '');
    }

    // Extract serial number (21) - variable length
    const serialMatch = remaining.match(/\(21\)([^()]{1,20})/);
    if (serialMatch) {
      result.serialNumber = serialMatch[1].trim();
      remaining = remaining.replace(serialMatch[0], '');
    }

    // Check if we successfully parsed any GS1 data
    result.isValid = !!(result.gtin || result.batchLot || result.expiryDate || result.serialNumber);

    // If no GS1 data found, treat as regular barcode (not an error)
    if (!result.isValid && result.errors.length === 0) {
      // This is expected for non-GS1 barcodes
    }
  } catch (error) {
    result.errors.push(`Parse error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return result;
}

/**
 * Validates if a barcode appears to be GS1 formatted
 * @param barcode - The barcode string to check
 * @returns true if the barcode contains GS1 Application Identifiers
 */
export function isGS1Barcode(barcode: string): boolean {
  if (!barcode) return false;

  // Check for common GS1 AIs
  const gs1Patterns = [
    /\(01\)/, // GTIN
    /\(10\)/, // Batch
    /\(17\)/, // Expiry
    /\(21\)/, // Serial
  ];

  return gs1Patterns.some((pattern) => pattern.test(barcode));
}
