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

import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { EventEmitter } from 'events';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { envConfig } from '../config/environment';
import { Logger } from '../utils/logger';
import { getOrganizationId } from '../utils/auth-bypass';
import { UploadImportType, UploadImportTypeValue } from '../types/upload.types';
import { parseExpiryImportDate } from './expiry-import-date-parser';

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
  /** Organization ID for tenant-scoped product imports */
  organizationId?: string;
}

export interface ParsedRow {
  sku: string;
  name: string;
  barcode: string;
  costPrice: number;
  /** Original row number in CSV (1-indexed, excluding header) */
  rowNumber: number;
}

export interface ExpiryParsedRow {
  sku: string;
  itemDescription?: string;
  usedByDate: string;
  /** Department name from the Department column; undefined when not provided */
  department?: string;
  /** Original row number in CSV (1-indexed, excluding header) */
  rowNumber: number;
}

export interface RowError {
  rowNumber: number;
  field: string;
  value: string;
  message: string;
  reasonCode?: string;
  rawValues?: Record<string, string>;
}

export interface CSVParseResult {
  /** @deprecated Legacy compatibility for older tests; derived from errors.length === 0 */
  success?: boolean;
  /** @deprecated Legacy compatibility for older tests; mirrors total */
  rowsProcessed?: number;
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
  /** Columns used from CSV */
  columnsUsed?: string[];
  /** Number of columns ignored */
  columnsIgnored?: number;
}

export interface CSVMetricsContext {
  uploadKey?: string;
  userId?: number;
  importType?: UploadImportTypeValue;
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
const PRODUCT_COLUMN_ALTERNATIVES = {
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
  barcode: [
    'Barcode',
    'Alias',
    'EAN',
    'UPC',
    'GTIN',
    'Product Barcode',
    'Barcode Number',
    'barcode',
    'ean',
    'upc',
  ],
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
    'cost',
    'cost_price',
    'price',
  ],
};

const EXPIRY_COLUMN_ALTERNATIVES = {
  sku: PRODUCT_COLUMN_ALTERNATIVES.sku,
  itemDescription: PRODUCT_COLUMN_ALTERNATIVES.name,
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
  department: [
    'Department',
    'Dept',
    'Location',
    'Store Area',
    'Area',
    'Section',
    'department',
    'dept',
    'location',
    'store_area',
  ],
} as const;

// Characters that could indicate CSV injection attempts
const CSV_INJECTION_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

// ============================================================================
// CSV Parser Service
// ============================================================================

export class CSVParserService extends EventEmitter {
  private static readonly UNALLOCATED_DEPARTMENT_NAME = 'Unallocated';

  private prisma: PrismaClient;
  private options: Required<CSVParserOptions>;
  private organizationId: string;

  /**
   * Constructor with optional dependency injection
   * @param prismaClient - Optional PrismaClient for testing/custom configurations
   * @param options - Parser configuration options
   */
  constructor(prismaClient?: PrismaClient, options: CSVParserOptions = {}) {
    super();
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.organizationId = options.organizationId ?? getOrganizationId();
    this.options = {
      batchSize: options.batchSize ?? 100,
      progressInterval: options.progressInterval ?? 1000,
      skipInvalidRows: options.skipInvalidRows ?? true,
      maxFileSize: options.maxFileSize ?? 10 * 1024 * 1024, // 10MB
      organizationId: this.organizationId,
    };
  }

  /**
   * Process a CSV file using streaming
   * @param filePath - Path to the CSV file
   * @returns Parse result with import statistics
   */
  async processFile(filePath: string, context: CSVMetricsContext = {}): Promise<CSVParseResult> {
    const startTime = Date.now();
    const importType = context.importType ?? UploadImportType.PRODUCT_CATALOG;

    // Validate file exists and check size
    await this.validateFile(filePath);

    // Track column usage
    let totalColumnsInFile = 0;
    const usedColumns: string[] = [];

    const result: CSVParseResult = {
      success: true,
      rowsProcessed: 0,
      imported: 0,
      updated: 0,
      skipped: 0,
      total: 0,
      errors: [],
      durationMs: 0,
    };

    // Track seen identities for duplicate detection within this file
    const seenSkus = new Set<string>();

    // Batch accumulator
    let batch: Array<ParsedRow | ExpiryParsedRow> = [];
    let headerMap: Map<string, string> | null = null;

    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      skip_records_with_error: true,
      relax_column_count: true,
      trim: true,
      cast: false, // Keep all values as strings
    });

    const fileStream = fs.createReadStream(filePath);

    // Pipe file to parser
    fileStream.pipe(parser);

    // Use async iteration for proper handling
    try {
      for await (const record of parser) {
        result.total++;
        result.rowsProcessed = result.total;

        // Initialize header mapping on first record
        if (!headerMap) {
          const csvHeaders = Object.keys(record);
          totalColumnsInFile = csvHeaders.length;
          headerMap = this.buildHeaderMap(csvHeaders, importType);

          // Track which columns we're actually using
          headerMap.forEach((actualHeader) => {
            if (!usedColumns.includes(actualHeader)) {
              usedColumns.push(actualHeader);
            }
          });

          // Validate required headers exist
          const headerValidation = this.validateHeaders(headerMap, importType);
          if (!headerValidation.isValid) {
            headerValidation.errors.forEach((err) => result.errors.push(err));
            if (!this.options.skipInvalidRows) {
              fileStream.destroy();
              parser.destroy();
              result.durationMs = Date.now() - startTime;
              // Emit final progress before returning
              this.emitProgress(result);
              this.emit('complete', result);
              return result;
            }
          }
        }

        // Parse and validate row
        const parseResult =
          importType === UploadImportType.EXPIRY_LIST
            ? this.parseExpiryRow(record, result.total, headerMap)
            : this.parseProductRow(record, result.total, headerMap, seenSkus);

        if (parseResult.errors.length > 0) {
          result.errors.push(...parseResult.errors);
          result.skipped++;
        } else if (parseResult.row) {
          batch.push(parseResult.row);
          if (importType !== UploadImportType.EXPIRY_LIST) {
            seenSkus.add(parseResult.row.sku.toLowerCase());
          }
        }

        // Process batch when full
        if (batch.length >= this.options.batchSize) {
          try {
            const batchResult = await this.processBatch(batch, importType);
            result.imported += batchResult.imported;
            result.updated += batchResult.updated;
            batch = [];
          } catch (error) {
            result.errors.push({
              rowNumber: result.total,
              field: 'batch',
              value: '',
              message: `Batch insert failed: ${(error as Error).message}`,
            });
            // Continue processing other batches on insert error
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
          const batchResult = await this.processBatch(batch, importType);
          result.imported += batchResult.imported;
          result.updated += batchResult.updated;
        } catch (error) {
          result.errors.push({
            rowNumber: result.total,
            field: 'batch',
            value: '',
            message: `Final batch insert failed: ${(error as Error).message}`,
          });
        }
      }
    } catch (error) {
      result.errors.push({
        rowNumber: result.total,
        field: 'parser',
        value: '',
        message: `CSV parsing error: ${(error as Error).message}`,
      });
    } finally {
      // Ensure streams are properly cleaned up in all paths
      try {
        fileStream.destroy();
        parser.destroy();
      } catch (cleanupError) {
        Logger.error('Error during stream cleanup:', { error: cleanupError });
      }
    }

    result.durationMs = Date.now() - startTime;
    result.rowsProcessed = result.total;
    result.success = result.errors.length === 0;

    // Add column usage information
    if (usedColumns.length > 0) {
      result.columnsUsed = usedColumns;
      result.columnsIgnored = Math.max(0, totalColumnsInFile - usedColumns.length);
    }

    // Emit final progress
    this.emitProgress(result);
    this.emit('complete', result);

    Logger.info('CSV processing metrics', {
      uploadKey: context.uploadKey,
      userId: context.userId,
      importType,
      totalRows: result.total,
      imported: result.imported,
      updated: result.updated,
      skipped: result.skipped,
      errorCount: result.errors.length,
      durationMs: result.durationMs,
      columnsUsed: result.columnsUsed?.length,
      columnsIgnored: result.columnsIgnored,
    });

    return result;
  }

  /**
   * Validate file exists and check size limits
   */
  private async validateFile(filePath: string): Promise<void> {
    try {
      const stats = await fs.promises.stat(filePath);

      if (stats.size > this.options.maxFileSize) {
        throw new Error(
          `File size ${stats.size} exceeds maximum allowed ${this.options.maxFileSize} bytes`,
        );
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
  private buildHeaderMap(
    headers: string[],
    importType: UploadImportTypeValue,
  ): Map<string, string> {
    const map = new Map<string, string>();
    const alternativesByField =
      importType === UploadImportType.EXPIRY_LIST
        ? EXPIRY_COLUMN_ALTERNATIVES
        : PRODUCT_COLUMN_ALTERNATIVES;

    for (const [field, alternatives] of Object.entries(alternativesByField)) {
      for (const alt of alternatives) {
        const found = headers.find((h) => h.toLowerCase().trim() === alt.toLowerCase());
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
  private validateHeaders(
    headerMap: Map<string, string>,
    importType: UploadImportTypeValue,
  ): {
    isValid: boolean;
    errors: RowError[];
  } {
    const errors: RowError[] = [];
    const requiredFields =
      importType === UploadImportType.EXPIRY_LIST
        ? ['sku', 'usedByDate']
        : ['sku', 'name', 'barcode', 'cost'];
    const alternativesByField =
      importType === UploadImportType.EXPIRY_LIST
        ? EXPIRY_COLUMN_ALTERNATIVES
        : PRODUCT_COLUMN_ALTERNATIVES;

    for (const field of requiredFields) {
      if (!headerMap.has(field)) {
        errors.push({
          rowNumber: 0,
          field: 'header',
          value: field,
          message: `Missing required column: ${field}. Expected one of: ${alternativesByField[field as keyof typeof alternativesByField].join(', ')}`,
        });
      }
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Extract a field value from a record using the header map
   */
  private extractField(
    record: Record<string, string>,
    headerMap: Map<string, string>,
    fieldName: string,
  ): string | undefined {
    const header = headerMap.get(fieldName);
    return header ? record[header] : undefined;
  }

  /**
   * Validate that a required field is present and non-empty
   */
  private validateRequiredField(
    value: string | undefined,
    fieldName: string,
    rowNumber: number,
  ): RowError | null {
    if (!value || value.trim() === '') {
      return {
        rowNumber,
        field: fieldName,
        value: value || '',
        message: `${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} is required and cannot be empty`,
      };
    }
    return null;
  }

  /**
   * Parse and validate a single row
   */
  private parseProductRow(
    record: Record<string, string>,
    rowNumber: number,
    headerMap: Map<string, string>,
    seenSkus: Set<string>,
  ): { row: ParsedRow | null; errors: RowError[] } {
    const errors: RowError[] = [];

    // Extract values using header map
    const rawSku = this.extractField(record, headerMap, 'sku');
    const rawName = this.extractField(record, headerMap, 'name');
    const rawBarcode = this.extractField(record, headerMap, 'barcode');
    const rawCost = this.extractField(record, headerMap, 'cost');

    // Validate required fields
    const requiredFields = [
      { value: rawSku, name: 'sku' },
      { value: rawName, name: 'name' },
      { value: rawBarcode, name: 'barcode' },
      { value: rawCost, name: 'cost' },
    ];

    for (const field of requiredFields) {
      const error = this.validateRequiredField(field.value, field.name, rowNumber);
      if (error) {
        errors.push(error);
      }
    }

    // Early return if required fields missing
    if (errors.length > 0) {
      return { row: null, errors };
    }

    // Sanitize values (CSV injection protection)
    const sku = this.sanitizeValue(rawSku?.trim() || '');
    const name = this.sanitizeValue(rawName?.trim() || '');
    const barcode = this.sanitizeValue(rawBarcode?.trim() || '');

    // Parse cost value
    const costPrice = this.parseCostValue(rawCost?.trim() || '');
    if (costPrice === null) {
      errors.push({
        rowNumber,
        field: 'cost',
        value: rawCost || '',
        message: 'Invalid cost format. Expected numeric value (e.g., "12.99", "$12.99")',
      });
      return { row: null, errors };
    }

    // Check for duplicate SKU within this file
    if (seenSkus.has(sku.toLowerCase())) {
      errors.push({
        rowNumber,
        field: 'sku',
        value: sku,
        message: `Duplicate SKU found in file (first occurrence will be used)`,
      });
      return { row: null, errors };
    }

    return {
      row: { sku, name, barcode, costPrice, rowNumber },
      errors,
    };
  }

  private parseExpiryRow(
    record: Record<string, string>,
    rowNumber: number,
    headerMap: Map<string, string>,
  ): { row: ExpiryParsedRow | null; errors: RowError[] } {
    const errors: RowError[] = [];

    const rawSku = this.extractField(record, headerMap, 'sku');
    const rawItemDescription = this.extractField(record, headerMap, 'itemDescription');
    const rawUsedByDate = this.extractField(record, headerMap, 'usedByDate');
    const rawDepartment = this.extractField(record, headerMap, 'department');
    const rawValues = {
      sku: rawSku?.trim() || '',
      itemDescription: rawItemDescription?.trim() || '',
      usedByDate: rawUsedByDate?.trim() || '',
      department: rawDepartment?.trim() || '',
    };

    const requiredFields = [
      { value: rawSku, name: 'sku' },
      { value: rawUsedByDate, name: 'usedByDate' },
    ];

    for (const field of requiredFields) {
      const error = this.validateRequiredField(field.value, field.name, rowNumber);
      if (error) {
        errors.push({
          ...error,
          reasonCode: 'missing-required-field',
          rawValues,
        });
      }
    }

    if (errors.length > 0) {
      return { row: null, errors };
    }

    const sku = this.sanitizeValue(rawSku?.trim() || '');
    const itemDescription = rawItemDescription ? this.sanitizeValue(rawItemDescription.trim()) : '';
    const usedByInput = rawUsedByDate?.trim() || '';
    const parsedDate = parseExpiryImportDate(usedByInput);

    if (!parsedDate.ok || !parsedDate.isoDate) {
      errors.push({
        rowNumber,
        field: 'usedByDate',
        value: usedByInput,
        message: `${parsedDate.errorCode}: ${parsedDate.errorMessage}`,
        reasonCode: parsedDate.errorCode,
        rawValues,
      });
      return { row: null, errors };
    }

    const departmentRaw = rawDepartment?.trim();
    const department =
      departmentRaw && departmentRaw !== ''
        ? this.sanitizeValue(departmentRaw)
        : undefined;

    return {
      row: {
        sku,
        itemDescription,
        usedByDate: parsedDate.isoDate,
        department,
        rowNumber,
      },
      errors,
    };
  }

  /**
   * Sanitize a string value to prevent CSV injection
   * Uses single quote prefix for dangerous prefixes (Excel treats as literal)
   */
  private sanitizeValue(value: string): string {
    let sanitized = value;

    // Escape dangerous prefixes with single quote (Excel treats as literal)
    for (const prefix of CSV_INJECTION_PREFIXES) {
      if (sanitized.startsWith(prefix)) {
        // Prefix with single quote to neutralize formula injection
        sanitized = "'" + sanitized;
        break;
      }
    }

    return sanitized;
  }

  /**
   * Check if a cost string has invalid letter/digit mixing
   */
  private hasInvalidLetterMixing(value: string): boolean {
    const hasCurrencyCodePrefix = /^[A-Z]{3,4}\s+[\d]/i.test(value);
    const hasLettersMixedWithDigits = /[a-zA-Z]/.test(value.replace(/^[A-Z]{3,4}\s+/i, ''));
    return hasLettersMixedWithDigits && !hasCurrencyCodePrefix;
  }

  /**
   * Extract value from accounting-style parentheses notation: "(12.34)" -> "12.34", isNegative=true
   */
  private extractFromParentheses(value: string): { cleaned: string; isNegative: boolean } {
    if (value.includes('(') && value.includes(')')) {
      const match = value.match(/\(([^)]+)\)/);
      if (match) {
        return { cleaned: match[1], isNegative: true };
      }
    }
    return { cleaned: value, isNegative: false };
  }

  /**
   * Strip currency codes and symbols from a value
   */
  private stripCurrencySymbols(value: string): string {
    let cleaned = value;
    cleaned = cleaned.replace(/^[A-Z]{3,4}\s+/i, ''); // Currency codes like "USD ", "EUR "
    cleaned = cleaned.replace(/[\s$€£¥₹₽₪₨₩₦₡₫Є₴₵₸₺₼₾₯]/g, '');
    return cleaned;
  }

  /**
   * Normalize decimal separators (handle US vs European formats)
   */
  private normalizeDecimalSeparator(value: string): string {
    const lastDot = value.lastIndexOf('.');
    const lastComma = value.lastIndexOf(',');

    if (lastDot > lastComma) {
      // US format: dots are decimal, commas are thousands
      return value.replace(/,/g, '');
    } else if (lastComma > lastDot) {
      // European format: commas are decimal, dots are thousands
      return value.replace(/\./g, '').replace(',', '.');
    } else if (lastComma !== -1 && lastDot === -1) {
      // Only comma - check if it's decimal separator (1-2 digits after)
      if (value.match(/,\d{1,2}$/)) {
        return value.replace(',', '.');
      }
      return value.replace(/,/g, '');
    }
    // No separators or both absent
    return value;
  }

  /**
   * Parse a cost string into a number, handling various formats
   */
  private parseCostValue(costStr: string): number | null {
    let cleaned = costStr.trim();

    // Early rejection for invalid letter/digit mixing
    if (this.hasInvalidLetterMixing(cleaned)) {
      return null;
    }

    // Handle accounting-style parentheses: "(12.34)" = -12.34
    const parenthesesResult = this.extractFromParentheses(cleaned);
    cleaned = parenthesesResult.cleaned;
    let isNegative = parenthesesResult.isNegative;

    // Strip currency codes and symbols
    cleaned = this.stripCurrencySymbols(cleaned);

    // Handle leading negative sign
    if (cleaned.startsWith('-')) {
      isNegative = true;
      cleaned = cleaned.substring(1);
    }

    // Reject if letters remain after stripping currency
    if (/[a-zA-Z]/.test(cleaned)) {
      return null;
    }

    // Normalize decimal separators (US vs European)
    cleaned = this.normalizeDecimalSeparator(cleaned);

    // Final validation: should only contain digits, dots, commas, spaces
    if (!/^-?[\d,.\s]*$/.test(cleaned)) {
      return null;
    }

    // Remove any remaining non-numeric characters except decimal point
    cleaned = cleaned.replace(/[^\d.]/g, '');

    const value = parseFloat(cleaned);
    return Number.isNaN(value) ? null : isNegative ? -value : value;
  }

  /**
   * Process a batch of rows using Prisma transaction
   */
  private async processBatch(
    batch: Array<ParsedRow | ExpiryParsedRow>,
    importType: UploadImportTypeValue,
  ): Promise<{ imported: number; updated: number }> {
    if (importType === UploadImportType.EXPIRY_LIST) {
      let imported = 0;
      let merged = 0;

      await this.prisma.$transaction(
        async (tx) => {
          // Cache store area IDs within the transaction to avoid repeated DB lookups
          const storeAreaCache = new Map<string, number>();

          // First-wins merge inside the current batch
          const dedupedRows = new Map<string, ExpiryParsedRow>();
          for (const row of batch as ExpiryParsedRow[]) {
            const dedupeKey = `${row.sku.toLowerCase()}|${row.usedByDate}`;
            if (dedupedRows.has(dedupeKey)) {
              merged++;
              continue;
            }

            dedupedRows.set(dedupeKey, row);
          }

          for (const row of dedupedRows.values()) {
            const product = await this.getOrCreateExpiryProduct(tx, row);
            const [dayStart, dayEnd] = this.getUtcDayRange(row.usedByDate);

            const existingInventory = await tx.inventoryItem.findFirst({
              where: {
                organizationId: this.organizationId,
                productId: product.id,
                expiryDate: {
                  gte: dayStart,
                  lte: dayEnd,
                },
              },
              select: { id: true },
            });

            if (existingInventory) {
              merged++;
              continue;
            }

            const departmentName =
              row.department ?? CSVParserService.UNALLOCATED_DEPARTMENT_NAME;
            let locationId = storeAreaCache.get(departmentName);
            if (locationId === undefined) {
              locationId = await this.getOrCreateStoreAreaByName(tx, departmentName);
              storeAreaCache.set(departmentName, locationId);
            }

            await tx.inventoryItem.create({
              data: {
                organizationId: this.organizationId,
                productId: product.id,
                expiryDate: dayStart,
                locationId,
                status: this.calculateInventoryStatus(dayStart),
              },
            });
            imported++;
          }

          if (imported > 0) {
            await tx.organizationUsage.updateMany({
              where: { organizationId: this.organizationId },
              data: {
                totalInventoryItems: { increment: imported },
              },
            });
          }
        },
        {
          maxWait: envConfig.CSV_TRANSACTION_MAX_WAIT_MS,
          timeout: envConfig.CSV_TRANSACTION_TIMEOUT_MS,
        },
      );

      return {
        imported,
        updated: merged,
      };
    }

    let imported = 0;
    let updated = 0;

    await this.prisma.$transaction(
      async (tx) => {
        for (const row of batch as ParsedRow[]) {
          // Check if product exists by SKU or barcode
          const existing = await tx.product.findFirst({
            where: {
              organizationId: this.organizationId,
              OR: [{ sku: row.sku }, { barcode: row.barcode }],
            },
          });

          if (existing) {
            // Update existing product
            await tx.product.update({
              where: { id: existing.id },
              data: {
                name: row.name,
                costPrice: row.costPrice,
                // Update barcode if it changed
                barcode: row.barcode,
              },
            });
            updated++;
          } else {
            // Create new product
            await tx.product.create({
              data: {
                organizationId: this.organizationId,
                sku: row.sku,
                name: row.name,
                barcode: row.barcode,
                costPrice: row.costPrice,
              },
            });
            imported++;
          }
        }
      },
      {
        // Neon can exceed Prisma's default 5s interactive transaction timeout
        // for 100-row CSV batches in integration tests and higher-latency environments.
        maxWait: envConfig.CSV_TRANSACTION_MAX_WAIT_MS,
        timeout: envConfig.CSV_TRANSACTION_TIMEOUT_MS,
      },
    );

    return { imported, updated };
  }

  private async getOrCreateStoreAreaByName(
    tx: Prisma.TransactionClient,
    name: string,
  ): Promise<number> {
    const existing = await tx.storeArea.findFirst({
      where: {
        organizationId: this.organizationId,
        name,
      },
      orderBy: { id: 'asc' },
      select: { id: true },
    });

    if (existing) {
      return existing.id;
    }

    const created = await tx.storeArea.create({
      data: {
        organizationId: this.organizationId,
        name,
        subDepartment: null,
      },
      select: { id: true },
    });

    return created.id;
  }

  private async getOrCreateExpiryProduct(
    tx: Prisma.TransactionClient,
    row: ExpiryParsedRow,
  ): Promise<{ id: number }> {
    const existing = await tx.product.findFirst({
      where: {
        organizationId: this.organizationId,
        sku: row.sku,
      },
      select: { id: true },
    });

    if (existing) {
      return existing;
    }

    const barcode = await this.createUniqueImportBarcode(tx, row.sku);
    const productName = row.itemDescription?.trim() ? row.itemDescription.trim() : row.sku;

    return tx.product.create({
      data: {
        organizationId: this.organizationId,
        sku: row.sku,
        name: productName,
        barcode,
        costPrice: 0,
      },
      select: { id: true },
    });
  }

  private async createUniqueImportBarcode(
    tx: Prisma.TransactionClient,
    sku: string,
  ): Promise<string> {
    const sanitizedSku = sku.replace(/\s+/g, '-');
    const base = `EXP-IMPORT-${sanitizedSku}`;
    let candidate = base;
    let suffix = 1;

    while (true) {
      const exists = await tx.product.findFirst({
        where: {
          organizationId: this.organizationId,
          barcode: candidate,
        },
        select: { id: true },
      });

      if (!exists) {
        return candidate;
      }

      candidate = `${base}-${suffix}`;
      suffix++;
    }
  }

  private getUtcDayRange(isoDate: string): [Date, Date] {
    const start = new Date(`${isoDate}T00:00:00.000Z`);
    const end = new Date(`${isoDate}T23:59:59.999Z`);
    return [start, end];
  }

  private calculateInventoryStatus(
    expiryDate: Date,
  ): 'Normal' | 'Markdown 1' | 'Markdown 2' | 'Markdown 3' | 'Expired' {
    const now = new Date();
    const daysDiff = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff <= 0) {
      return 'Expired';
    }

    if (daysDiff <= 7) {
      return 'Markdown 3';
    }

    if (daysDiff <= 14) {
      return 'Markdown 2';
    }

    if (daysDiff <= 30) {
      return 'Markdown 1';
    }

    return 'Normal';
  }

  /**
   * Emit a progress event
   */
  private emitProgress(result: CSVParseResult): void {
    const event: ProgressEvent = {
      processed: result.total,
      imported: result.imported + result.updated,
      errors: result.errors.length,
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
