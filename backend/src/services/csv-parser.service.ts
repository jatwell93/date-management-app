/**
 * Streaming CSV Parser Service
 * 
 * A dedicated service for processing CSV files using streaming to maintain
 * constant memory usage regardless of file size. Supports batch database
 * inserts, progress reporting, and comprehensive error handling.
 * 
 * Key Features:
 * - Line-by-line streaming (constant memory)
 * - Batch accumulation (100 rows per batch)
 * - Prisma transaction inserts
 * - CSV injection protection
 * - Progress events every 1000 rows
 * - Row-level error collection
 * - Duplicate SKU detection
 */

import { PrismaClient } from "@prisma/client";
import { EventEmitter } from "events";
import { parse, Parser } from "csv-parse";
import * as fs from "fs";
import { getDefaultDatabaseClient } from "../database/database-factory";

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface CSVParserOptions {
  /** Number of rows to accumulate before batch insert (default: 100) */
  batchSize?: number;
  /** Report progress every N rows (default: 1000) */
  progressInterval?: number;
  /** Skip rows with validation errors vs. abort (default: true) */
  skipInvalidRows?: boolean;
  /** Maximum file size in bytes (default: 10MB) */
  maxFileSize?: number;
}

export interface ParsedRow {
  sku: string;
  name: string;
  barcode: string;
  costPrice: number;
  /** Original row number in CSV (1-indexed, excluding header) */
  rowNumber: number;
}

export interface RowError {
  rowNumber: number;
  field: string;
  value: string;
  message: string;
}

export interface CSVParseResult {
  /** Number of rows successfully imported */
  imported: number;
  /** Number of rows updated (existing SKU/barcode) */
  updated: number;
  /** Number of rows skipped due to errors */
  skipped: number;
  /** Total rows processed */
  total: number;
  /** Collected errors */
  errors: RowError[];
  /** Processing time in milliseconds */
  durationMs: number;
}

export interface ProgressEvent {
  /** Rows processed so far */
  processed: number;
  /** Rows imported so far */
  imported: number;
  /** Rows with errors so far */
  errors: number;
  /** Estimated percentage complete (if file size known) */
  percentComplete?: number;
}

// Column name alternatives for flexible header matching
const COLUMN_ALTERNATIVES = {
  sku: ['SKU', 'Item Code', 'Reorder Number', 'Product Code', 'Item Number', 'sku', 'item_code', 'product_code'],
  name: ['Name', 'Item Description', 'Product Name', 'Description', 'Item Name', 'name', 'description', 'product_name'],
  barcode: ['Barcode', 'Alias', 'EAN', 'UPC', 'GTIN', 'Product Barcode', 'Barcode Number', 'barcode', 'ean', 'upc'],
  cost: ['Cost', 'Cost Price', 'Unit Cost', 'Cost ex', 'Price', 'Unit Price', 'Cost inc', 'Selling Price', 'Retail Price', 'cost', 'cost_price', 'price']
};

// Characters that could indicate CSV injection attempts
const CSV_INJECTION_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

// ============================================================================
// CSV Parser Service
// ============================================================================

export class CSVParserService extends EventEmitter {
  private prisma: PrismaClient;
  private options: Required<CSVParserOptions>;

  /**
   * Constructor with optional dependency injection
   * @param prismaClient - Optional PrismaClient for testing/custom configurations
   * @param options - Parser configuration options
   */
  constructor(prismaClient?: PrismaClient, options: CSVParserOptions = {}) {
    super();
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.options = {
      batchSize: options.batchSize ?? 100,
      progressInterval: options.progressInterval ?? 1000,
      skipInvalidRows: options.skipInvalidRows ?? true,
      maxFileSize: options.maxFileSize ?? 10 * 1024 * 1024 // 10MB
    };
  }

  /**
   * Process a CSV file using streaming
   * @param filePath - Path to the CSV file
   * @returns Parse result with import statistics
   */
  async processFile(filePath: string): Promise<CSVParseResult> {
    const startTime = Date.now();
    
    // Validate file exists and check size
    await this.validateFile(filePath);

    const result: CSVParseResult = {
      imported: 0,
      updated: 0,
      skipped: 0,
      total: 0,
      errors: [],
      durationMs: 0
    };

    // Track seen SKUs for duplicate detection within this file
    const seenSkus = new Set<string>();
    
    // Batch accumulator
    let batch: ParsedRow[] = [];
    let headerMap: Map<string, string> | null = null;

    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      skip_records_with_error: true,
      relax_column_count: true,
      trim: true,
      cast: false // Keep all values as strings
    });

    const fileStream = fs.createReadStream(filePath);
    
    // Pipe file to parser
    fileStream.pipe(parser);

    // Use async iteration for proper handling
    try {
      for await (const record of parser) {
        result.total++;

        // Initialize header mapping on first record
        if (!headerMap) {
          headerMap = this.buildHeaderMap(Object.keys(record));
          
          // Validate required headers exist
          const headerValidation = this.validateHeaders(headerMap);
          if (!headerValidation.isValid) {
            headerValidation.errors.forEach(err => result.errors.push(err));
            if (!this.options.skipInvalidRows) {
              fileStream.destroy();
              result.durationMs = Date.now() - startTime;
              return result;
            }
          }
        }

        // Parse and validate row
        const parseResult = this.parseRow(record, result.total, headerMap, seenSkus);
        
        if (parseResult.errors.length > 0) {
          result.errors.push(...parseResult.errors);
          result.skipped++;
        } else if (parseResult.row) {
          batch.push(parseResult.row);
          seenSkus.add(parseResult.row.sku.toLowerCase());
        }

        // Process batch when full
        if (batch.length >= this.options.batchSize) {
          try {
            const batchResult = await this.processBatch(batch);
            result.imported += batchResult.imported;
            result.updated += batchResult.updated;
            batch = [];
          } catch (error) {
            result.errors.push({
              rowNumber: result.total,
              field: 'batch',
              value: '',
              message: `Batch insert failed: ${(error as Error).message}`
            });
          }
        }

        // Emit progress event
        if (result.total % this.options.progressInterval === 0) {
          this.emitProgress(result);
        }
      }

      // Process remaining batch
      if (batch.length > 0) {
        try {
          const batchResult = await this.processBatch(batch);
          result.imported += batchResult.imported;
          result.updated += batchResult.updated;
        } catch (error) {
          result.errors.push({
            rowNumber: result.total,
            field: 'batch',
            value: '',
            message: `Final batch insert failed: ${(error as Error).message}`
          });
        }
      }

    } catch (error) {
      result.errors.push({
        rowNumber: result.total,
        field: 'parser',
        value: '',
        message: `CSV parsing error: ${(error as Error).message}`
      });
    }

    result.durationMs = Date.now() - startTime;
    
    // Emit final progress
    this.emitProgress(result);
    this.emit('complete', result);
    
    return result;
  }

  /**
   * Validate file exists and check size limits
   */
  private async validateFile(filePath: string): Promise<void> {
    try {
      const stats = await fs.promises.stat(filePath);
      
      if (stats.size > this.options.maxFileSize) {
        throw new Error(`File size ${stats.size} exceeds maximum allowed ${this.options.maxFileSize} bytes`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`File not found: ${filePath}`);
      }
      throw error;
    }
  }

  /**
   * Build a mapping from standard field names to actual CSV header names
   */
  private buildHeaderMap(headers: string[]): Map<string, string> {
    const map = new Map<string, string>();
    
    for (const [field, alternatives] of Object.entries(COLUMN_ALTERNATIVES)) {
      for (const alt of alternatives) {
        const found = headers.find(h => 
          h.toLowerCase().trim() === alt.toLowerCase()
        );
        if (found) {
          map.set(field, found);
          break;
        }
      }
    }
    
    return map;
  }

  /**
   * Validate that all required headers are present
   */
  private validateHeaders(headerMap: Map<string, string>): { isValid: boolean; errors: RowError[] } {
    const errors: RowError[] = [];
    const requiredFields = ['sku', 'name', 'barcode', 'cost'];
    
    for (const field of requiredFields) {
      if (!headerMap.has(field)) {
        errors.push({
          rowNumber: 0,
          field: 'header',
          value: field,
          message: `Missing required column: ${field}. Expected one of: ${COLUMN_ALTERNATIVES[field as keyof typeof COLUMN_ALTERNATIVES].join(', ')}`
        });
      }
    }
    
    return { isValid: errors.length === 0, errors };
  }

  /**
   * Parse and validate a single row
   */
  private parseRow(
    record: Record<string, string>,
    rowNumber: number,
    headerMap: Map<string, string>,
    seenSkus: Set<string>
  ): { row: ParsedRow | null; errors: RowError[] } {
    const errors: RowError[] = [];
    
    // Extract values using header map
    const skuHeader = headerMap.get('sku');
    const nameHeader = headerMap.get('name');
    const barcodeHeader = headerMap.get('barcode');
    const costHeader = headerMap.get('cost');

    const rawSku = skuHeader ? record[skuHeader] : undefined;
    const rawName = nameHeader ? record[nameHeader] : undefined;
    const rawBarcode = barcodeHeader ? record[barcodeHeader] : undefined;
    const rawCost = costHeader ? record[costHeader] : undefined;

    // Validate required fields
    if (!rawSku || rawSku.trim() === '') {
      errors.push({
        rowNumber,
        field: 'sku',
        value: rawSku || '',
        message: 'SKU is required and cannot be empty'
      });
    }

    if (!rawName || rawName.trim() === '') {
      errors.push({
        rowNumber,
        field: 'name',
        value: rawName || '',
        message: 'Name is required and cannot be empty'
      });
    }

    if (!rawBarcode || rawBarcode.trim() === '') {
      errors.push({
        rowNumber,
        field: 'barcode',
        value: rawBarcode || '',
        message: 'Barcode is required and cannot be empty'
      });
    }

    if (!rawCost || rawCost.trim() === '') {
      errors.push({
        rowNumber,
        field: 'cost',
        value: rawCost || '',
        message: 'Cost is required and cannot be empty'
      });
    }

    // Early return if required fields missing
    if (errors.length > 0) {
      return { row: null, errors };
    }

    // Sanitize values (CSV injection protection)
    const sku = this.sanitizeValue(rawSku!.trim());
    const name = this.sanitizeValue(rawName!.trim());
    const barcode = this.sanitizeValue(rawBarcode!.trim());

    // Parse cost value
    const costPrice = this.parseCostValue(rawCost!.trim());
    if (costPrice === null) {
      errors.push({
        rowNumber,
        field: 'cost',
        value: rawCost!,
        message: 'Invalid cost format. Expected numeric value (e.g., "12.99", "$12.99")'
      });
      return { row: null, errors };
    }

    // Check for duplicate SKU within this file
    if (seenSkus.has(sku.toLowerCase())) {
      errors.push({
        rowNumber,
        field: 'sku',
        value: sku,
        message: `Duplicate SKU found in file (first occurrence will be used)`
      });
      // Note: We still return null but this is a warning, not a hard error
      return { row: null, errors };
    }

    return {
      row: {
        sku,
        name,
        barcode,
        costPrice,
        rowNumber
      },
      errors
    };
  }

  /**
   * Sanitize a string value to prevent CSV injection
   */
  private sanitizeValue(value: string): string {
    let sanitized = value;
    
    // Remove or escape dangerous prefixes
    for (const prefix of CSV_INJECTION_PREFIXES) {
      if (sanitized.startsWith(prefix)) {
        // Prefix with single quote to neutralize formula
        sanitized = "'" + sanitized;
        break;
      }
    }
    
    return sanitized;
  }

  /**
   * Parse a cost string into a number, handling various formats
   */
  private parseCostValue(costStr: string): number | null {
    let cleaned = costStr.trim();
    let isNegative = false;

    // Early rejection: if the string has letters mixed in without a proper currency format,
    // reject it. Valid patterns are:
    // - Currency code prefix with REQUIRED space: "USD 12.99", "EUR 20,50"
    // - Symbol prefix: "$12.99", "€20,50"
    // - Pure numbers: "12.99", "1,234.56"
    // Invalid: "abc123", "12abc", "invalid"
    const hasCurrencyCodePrefix = /^[A-Z]{3,4}\s+[\d]/i.test(cleaned);
    const hasLettersMixedWithDigits = /[a-zA-Z]/.test(cleaned.replace(/^[A-Z]{3,4}\s+/i, ''));
    
    if (hasLettersMixedWithDigits && !hasCurrencyCodePrefix) {
      return null;
    }

    // Handle negative values in parentheses e.g., "(12.34)"
    if (cleaned.includes('(') && cleaned.includes(')')) {
      const match = cleaned.match(/\(([^)]+)\)/);
      if (match) {
        isNegative = true;
        cleaned = match[1];
      }
    }

    // Remove currency symbols and codes (require space between code and digits to avoid matching "abc123")
    cleaned = cleaned.replace(/^[A-Z]{3,4}\s+/i, ''); // Currency codes like "USD ", "EUR " with required space
    cleaned = cleaned.replace(/[\s$€£¥₹₽₪₨₩₦₡₫Є₴₵₸₺₼₾₯]/g, '');

    // Handle negative sign
    if (cleaned.startsWith('-')) {
      isNegative = true;
      cleaned = cleaned.substring(1);
    }

    // Check if remaining string looks like a valid number (digits, dots, commas only)
    // Reject strings that have letters mixed in
    if (/[a-zA-Z]/.test(cleaned)) {
      return null;
    }

    // Determine decimal separator
    const lastDot = cleaned.lastIndexOf('.');
    const lastComma = cleaned.lastIndexOf(',');

    if (lastDot > lastComma) {
      // US format: dots are decimal, commas are thousands
      cleaned = cleaned.replace(/,/g, '');
    } else if (lastComma > lastDot) {
      // European format: commas are decimal, dots are thousands
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (lastComma === -1 && lastDot === -1) {
      // No separators, just digits
    } else if (lastComma !== -1 && lastDot === -1) {
      // Only comma - check if it's decimal separator
      if (cleaned.match(/,\d{1,2}$/)) {
        cleaned = cleaned.replace(',', '.');
      } else {
        cleaned = cleaned.replace(/,/g, '');
      }
    }

    // After processing, check if the cleaned string is a valid number pattern
    // Must be: optional sign, digits, optional decimal part, optional more digits
    // Reject anything that has extraneous characters like letters mixed in
    if (!/^-?[\d,.\s]*$/.test(cleaned)) {
      return null;
    }

    // Remove any remaining non-numeric characters except decimal point
    cleaned = cleaned.replace(/[^\d.]/g, '');

    const value = parseFloat(cleaned);
    
    if (isNaN(value)) {
      return null;
    }

    return isNegative ? -value : value;
  }

  /**
   * Process a batch of rows using Prisma transaction
   */
  private async processBatch(batch: ParsedRow[]): Promise<{ imported: number; updated: number }> {
    let imported = 0;
    let updated = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const row of batch) {
        // Check if product exists by SKU or barcode
        const existing = await tx.product.findFirst({
          where: {
            OR: [
              { sku: row.sku },
              { barcode: row.barcode }
            ]
          }
        });

        if (existing) {
          // Update existing product
          await tx.product.update({
            where: { id: existing.id },
            data: {
              name: row.name,
              costPrice: row.costPrice,
              // Update barcode if it changed
              barcode: row.barcode
            }
          });
          updated++;
        } else {
          // Create new product
          await tx.product.create({
            data: {
              sku: row.sku,
              name: row.name,
              barcode: row.barcode,
              costPrice: row.costPrice
            }
          });
          imported++;
        }
      }
    });

    return { imported, updated };
  }

  /**
   * Emit a progress event
   */
  private emitProgress(result: CSVParseResult): void {
    const event: ProgressEvent = {
      processed: result.total,
      imported: result.imported + result.updated,
      errors: result.errors.length
    };
    this.emit('progress', event);
  }
}

// Export singleton factory for convenience
let defaultParserInstance: CSVParserService | null = null;

export function getCSVParser(options?: CSVParserOptions): CSVParserService {
  if (!defaultParserInstance) {
    defaultParserInstance = new CSVParserService(undefined, options);
  }
  return defaultParserInstance;
}

export function resetCSVParser(): void {
  defaultParserInstance = null;
}
