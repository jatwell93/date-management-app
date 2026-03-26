/**
 * GS1-128 barcode parser for pharmacy applications
 * Parses Application Identifiers (01), (10), (17), (21) commonly used in pharmaceutical barcodes
 */

import { GS1ParseResult } from '../types/handheld';

const GS_SEPARATOR = String.fromCharCode(29);

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
    // GS1-128 may include FNC1 prefixes/group separators or bracketed AIs.
    // Support both bracketed (e.g., (01)...) and raw AI (e.g., 01...10...21...).
    // eslint-disable-next-line no-control-regex
    const normalizedBarcode = barcode.replace(/^\]C1/, '').replace(/\u001d/g, GS_SEPARATOR);
    let remaining = normalizedBarcode;

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

    // If bracketed parsing didn't find anything, try raw AI parsing.
    if (
      !result.gtin &&
      !result.batchLot &&
      !result.expiryDate &&
      !result.serialNumber &&
      !/[()]/.test(normalizedBarcode)
    ) {
      const raw = normalizedBarcode;
      let index = 0;

      const findNextBoundary = (startIndex: number, candidates: string[]): number => {
        let boundary = raw.length;

        const separatorIndex = raw.indexOf(GS_SEPARATOR, startIndex);
        if (separatorIndex !== -1) {
          boundary = Math.min(boundary, separatorIndex);
        }

        for (const ai of candidates) {
          const aiIndex = raw.indexOf(ai, startIndex);
          if (aiIndex !== -1) {
            boundary = Math.min(boundary, aiIndex);
          }
        }

        return boundary;
      };

      while (index < raw.length) {
        if (raw[index] === GS_SEPARATOR) {
          index += 1;
          continue;
        }

        const ai = raw.slice(index, index + 2);

        if (ai === '01' && index + 16 <= raw.length && !result.gtin) {
          const gtin = raw.slice(index + 2, index + 16);
          if (/^\d{14}$/.test(gtin)) {
            result.gtin = gtin;
          }
          index += 16;
          continue;
        }

        if (ai === '17' && index + 8 <= raw.length && !result.expiryDate) {
          const yymmdd = raw.slice(index + 2, index + 8);
          const isoDate = convertYYMMDDToISO(yymmdd);
          if (isoDate) {
            result.expiryDate = isoDate;
          } else {
            result.errors.push(`Invalid expiry date format: ${yymmdd}`);
          }
          index += 8;
          continue;
        }

        if (ai === '10' && !result.batchLot) {
          const start = index + 2;
          const end = findNextBoundary(start, ['17', '21']);
          const batch = raw.slice(start, end).replace(new RegExp(GS_SEPARATOR, 'g'), '').trim();
          if (batch) {
            result.batchLot = batch;
          }
          index = end;
          continue;
        }

        if (ai === '21' && !result.serialNumber) {
          const start = index + 2;
          const end = findNextBoundary(start, ['10', '17']);
          const serial = raw.slice(start, end).replace(new RegExp(GS_SEPARATOR, 'g'), '').trim();
          if (serial) {
            result.serialNumber = serial;
          }
          index = end;
          continue;
        }

        index += 1;
      }
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

  const normalizedBarcode = barcode.replace(/^\]C1/, '');

  // Check for common GS1 AIs
  const gs1Patterns = [
    /\(01\)/, // GTIN
    /\(10\)/, // Batch
    /\(17\)/, // Expiry
    /\(21\)/, // Serial
    /01\d{14}/, // Raw GTIN AI format
    /17\d{6}/, // Raw expiry AI format
  ];

  return gs1Patterns.some((pattern) => pattern.test(normalizedBarcode));
}
