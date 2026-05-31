import { PrismaClient } from '@prisma/client';
import { Logger } from '../utils/logger';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { getOrganizationId } from '../utils/auth-bypass';
import { Product } from '../models/product.model';
import { parse } from 'csv-parse';
import * as XLSX from 'xlsx';
import fs from 'fs';
import { isPrismaNotFound } from '../utils/prisma-error';
import { NotFoundError } from '../errors';
import {
  detectProductImportFileType,
  getProductImportCsvColumnState,
  getProductImportCsvRowValues,
  getProductImportCsvUnexpectedColumns,
  getProductImportXlsxColumnState,
  getProductImportXlsxRowValues,
  getProductImportXlsxUnexpectedColumns,
  findColumnByAlternatives,
  findColumnIndexByAlternatives,
  parseProductImportCost,
  resolveProductImportOperation,
  validateProductImportRow,
} from './product-import.helpers';

import { injectable, inject } from 'tsyringe';
import { ProductRepository } from '../repositories/product.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { TIER_LIMITS, TierLevel } from '../types/subscription';

export function extractCostValue(costStr: string): number | null {
  // Remove common currency symbols and formatting
  let cleanedStr = costStr.trim();

  // Remove common currency symbols at the beginning or end
  cleanedStr = cleanedStr.replace(/^[\$€£¥₹₽₪₨]/, ''); // Remove common currency symbols from start
  cleanedStr = cleanedStr.replace(/[\$€£¥₹₽₪₨]$/, ''); // Remove common currency symbols from end

  // Remove any other non-numeric characters except decimal point and comma (for thousands)
  // Keep only digits, decimal point, and comma
  cleanedStr = cleanedStr.replace(/[^\d.,]/g, '');

  // Handle different decimal/thousands separator conventions
  // If there are multiple commas, assume the last one is the decimal separator
  const commaCount = (cleanedStr.match(/,/g) || []).length;
  if (commaCount > 1) {
    // Multiple commas - treat commas as thousands separators, last dot as decimal
    cleanedStr = cleanedStr.replace(/,(?=\d{1,2}$)/, '.'); // Replace last comma with dot if followed by 1-2 digits
    cleanedStr = cleanedStr.replace(/,/g, ''); // Remove remaining commas
  } else if (commaCount === 1) {
    // Single comma - check if it's followed by 1-2 digits (likely decimal separator)
    if (cleanedStr.match(/,\d{1,2}$/)) {
      cleanedStr = cleanedStr.replace(/,/, '.');
    } else {
      // Otherwise treat comma as thousands separator
      cleanedStr = cleanedStr.replace(/,/, '');
    }
  }

  // Now parse as float
  const value = parseFloat(cleanedStr);

  if (Number.isNaN(value)) {
    return null;
  }

  return value;
}

// Enhanced helper function to extract numeric value from cost string with flexible formatting
export function extractCostValueEnhanced(costStr: string): number | null {
  return parseProductImportCost(costStr);
}

@injectable()
export class ProductService {
  private prisma: PrismaClient;
  private organizationId: string;
  private productRepo: ProductRepository;
  private subscriptionRepo: SubscriptionRepository;

  /**
   * Constructor with optional dependency injection
   * @param prismaClient - Optional PrismaClient for testing/custom configurations
   * @param organizationId - Organization ID for tenant filtering (optional in tests)
   * @param productRepo - Optional ProductRepository
   * @param subscriptionRepo - Optional SubscriptionRepository
   */
  constructor(
    @inject(PrismaClient) prismaClient?: PrismaClient,
    @inject('OrganizationId') organizationId?: string,
    @inject(ProductRepository) productRepo?: ProductRepository,
    @inject(SubscriptionRepository) subscriptionRepo?: SubscriptionRepository,
  ) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.organizationId = getOrganizationId(organizationId);
    this.productRepo = productRepo ?? new ProductRepository(this.prisma);
    this.subscriptionRepo = subscriptionRepo ?? new SubscriptionRepository(this.prisma);
  }

  // Expose parser for tests that reference it via ProductService["extractCostValueEnhanced"]
  static extractCostValueEnhanced(costStr: string): number | null {
    return extractCostValueEnhanced(costStr);
  }
  async getAllProducts(limit?: number, offset?: number): Promise<Product[]> {
    const products = await this.productRepo.findAll(this.organizationId, limit, offset);
    return products.map(this.mapPrismaToModel);
  }

  async getProductById(id: number): Promise<Product | null> {
    const product = await this.productRepo.findById(id, this.organizationId);
    return product ? this.mapPrismaToModel(product) : null;
  }

  async getProductByBarcode(barcode: string): Promise<Product | null> {
    const product = await this.productRepo.findByBarcode(barcode, this.organizationId);
    return product ? this.mapPrismaToModel(product) : null;
  }

  async getProductBySku(sku: string): Promise<Product | null> {
    const product = await this.productRepo.findBySku(sku, this.organizationId);
    return product ? this.mapPrismaToModel(product) : null;
  }

  async createProduct(
    product: Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'organizationId'>,
  ): Promise<Product> {
    const result = await this.prisma.$transaction(async (tx) => {
      // Atomic check-and-increment to prevent TOCTOU race conditions
      const usage = await this.subscriptionRepo.findUsageByOrganizationId(this.organizationId, tx);

      if (!usage) {
        throw new Error('Organization usage record not found');
      }

      // Check limit BEFORE creating product (within same transaction)
      if (usage.totalSkus >= usage.maxSkus) {
        throw new Error(`SKU limit reached for this organization (${usage.maxSkus} max)`);
      }

      const newProduct = await this.productRepo.create(
        {
          barcode: product.barcode,
          sku: product.sku,
          name: product.name,
          costPrice: product.costPrice,
          organizationId: this.organizationId,
        },
        tx,
      );

      // Increment organization usage counter atomically
      await this.subscriptionRepo.updateUsage(
        this.organizationId,
        {
          totalSkus: { increment: 1 },
        },
        tx,
      );

      return newProduct;
    });

    return this.mapPrismaToModel(result);
  }

  async updateProduct(
    id: number,
    product: Partial<Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'organizationId'>>,
  ): Promise<Product | null> {
    if (Object.keys(product).length === 0) {
      return null;
    }

    try {
      const updatedProduct = await this.productRepo.update(
        id,
        this.organizationId,
        this.buildProductUpdateData(product),
      );
      return this.mapPrismaToModel(updatedProduct);
    } catch (error: unknown) {
      return this.handlePrismaNotFound(error);
    }
  }

  /**
   * Build update data object from partial product, filtering undefined values
   */
  private buildProductUpdateData(
    product: Partial<Omit<Product, 'id' | 'createdAt' | 'updatedAt'>>,
  ): { barcode?: string; sku?: string; name?: string; costPrice?: number } {
    const data: { barcode?: string; sku?: string; name?: string; costPrice?: number } = {};
    if (product.barcode !== undefined) data.barcode = product.barcode;
    if (product.sku !== undefined) data.sku = product.sku;
    if (product.name !== undefined) data.name = product.name;
    if (product.costPrice !== undefined) data.costPrice = product.costPrice;
    return data;
  }

  /**
   * Handle Prisma P2025 (record not found) error, rethrow others
   */
  private handlePrismaNotFound(error: unknown): null {
    if (isPrismaNotFound(error)) {
      return null;
    }
    throw error;
  }

  async deleteProduct(id: number): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // Delete the product
        await this.productRepo.delete(id, this.organizationId, tx);

        // Decrement organization usage counter
        await this.subscriptionRepo.updateUsage(
          this.organizationId,
          {
            totalSkus: { decrement: 1 },
          },
          tx,
        );
      });

      return true;
    } catch (error: unknown) {
      // Prisma throws P2025 when record not found
      if (isPrismaNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Map Prisma model to legacy Product interface
   */
  private mapPrismaToModel(product: {
    id: number;
    organizationId: string | null;
    barcode: string;
    sku: string;
    name: string;
    costPrice: number;
    notes: string;
    createdAt: Date;
    updatedAt: Date;
  }): Product {
    return {
      id: product.id,
      organizationId: product.organizationId ?? this.organizationId,
      barcode: product.barcode,
      sku: product.sku,
      name: product.name,
      costPrice: product.costPrice,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    };
  }

  async getExcessProductsView(organizationId: string): Promise<{
    tier: TierLevel;
    maxSkus: number | null;
    currentSkus: number;
    excessCount: number;
    products: Array<{
      id: number;
      sku: string;
      name: string;
      barcode: string;
      costPrice: number;
      createdAt: string;
      inventoryCount: number;
    }>;
  }> {
    const subscription = await this.subscriptionRepo.findByOrganizationId(organizationId);

    if (!subscription) {
      throw new NotFoundError('Subscription not found');
    }

    const tierLevel = subscription.tierLevel as TierLevel;
    const maxSkus = TIER_LIMITS[tierLevel].max_skus;
    const usage = await this.subscriptionRepo.findUsageByOrganizationId(organizationId);
    const currentCount = usage?.totalSkus || 0;

    if (maxSkus === null) {
      return {
        tier: tierLevel,
        maxSkus: null,
        currentSkus: currentCount,
        excessCount: 0,
        products: [],
      };
    }

    const excessCount = currentCount - maxSkus;

    if (excessCount <= 0) {
      return {
        tier: tierLevel,
        maxSkus,
        currentSkus: currentCount,
        excessCount: 0,
        products: [],
      };
    }

    const excessProducts = await this.productRepo.findExcessProductsByOrganization(
      organizationId,
      maxSkus,
    );

    const products = excessProducts.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      barcode: p.barcode,
      costPrice: p.costPrice,
      createdAt: p.createdAt.toISOString(),
      inventoryCount: p._count.inventoryItems,
    }));

    return {
      tier: tierLevel,
      maxSkus,
      currentSkus: currentCount,
      excessCount,
      products,
    };
  }

  async processCSVUpload(
    filePath: string,
    originalFilename?: string,
  ): Promise<{ imported: number; updated: number; errors: string[] }> {
    const fileType = await detectProductImportFileType(filePath, originalFilename);

    if (fileType === 'xlsx' || fileType === 'xls') {
      return this.processXLSXUpload(filePath);
    } else {
      return this.processCSVUploadInternal(filePath);
    }
  }

  async processCSVUploadInternal(filePath: string): Promise<{
    imported: number;
    updated: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let imported = 0;
    let updated = 0;
    // First, validate the CSV structure
    const validation = await this.validateCSVStructure(filePath);
    if (!validation.isValid) {
      return { imported: 0, updated: 0, errors: [...errors, ...validation.errors] };
    }
    // Use a Promise to handle the async processing correctly
    return new Promise((resolve, reject) => {
      let recordCount = 0;
      const processingPromises: Promise<void>[] = [];
      fs.createReadStream(filePath)
        .pipe(
          parse({
            columns: true, // Use auto-generated columns from header row
            skip_empty_lines: true,
            // Add additional CSV validation options
            skip_records_with_error: true, // Skip records that cause errors
            cast: (value, _context) => {
              // Don't cast any values to avoid automatic type conversion
              // This ensures barcodes in scientific notation stay as strings
              return value;
            },
          }),
        )
        .on('error', (error) => {
          Logger.error('CSV parsing error', {
            error: error instanceof Error ? error.message : String(error),
          });
          errors.push(`CSV parsing error: ${error.message}`);
          reject({ imported, updated, errors });
        })
        .on('data', (row) => {
          recordCount++;
          const rowNumber = recordCount;

          // Create a promise for each row processing to handle async operations properly
          const rowProcessingPromise = (async () => {
            try {
              // Find the correct column for each field based on alternatives
              const columnState = getProductImportCsvColumnState(row);

              // Validate required fields - check if headers exist before accessing
              const { sku, name, costStr, barcode } = getProductImportCsvRowValues(
                row,
                columnState,
              );
              const validation = validateProductImportRow({
                rowNumber,
                values: { sku, name, costStr, barcode },
                unexpectedColumns: getProductImportCsvUnexpectedColumns(row, columnState),
              });

              if (!validation.isValid) {
                errors.push(...validation.errors);
                return;
              }

              // Check if product already exists (by SKU or Barcode)
              let existingProduct: Product | null = null;
              try {
                existingProduct = await this.getProductBySkuOrBarcode(
                  validation.row.sku,
                  validation.row.barcode,
                );
              } catch (duplicateError: unknown) {
                const errorMessage =
                  duplicateError instanceof Error ? duplicateError.message : 'Unknown error';
                errors.push(`Row ${rowNumber}: ${errorMessage}`);
                return; // Skip processing this row
              }

              if (existingProduct) {
                // Update existing product
                try {
                  await this.updateProduct(existingProduct.id, {
                    barcode: validation.row.barcode,
                    sku: validation.row.sku, // Update SKU as well in case it changed
                    name: validation.row.name,
                    costPrice: validation.row.cost,
                  });
                  updated++;
                } catch (updateError: unknown) {
                  const errorMessage =
                    updateError instanceof Error ? updateError.message : 'Unknown error';
                  errors.push(
                    `Row ${rowNumber}: Failed to update existing product (SKU: ${validation.row.sku}) - ${errorMessage}`,
                  );
                }
              } else {
                // Create new product
                try {
                  await this.createProduct({
                    barcode: validation.row.barcode,
                    sku: validation.row.sku,
                    name: validation.row.name,
                    costPrice: validation.row.cost,
                  });
                  imported++;
                } catch (createError: unknown) {
                  const errorMessage =
                    createError instanceof Error ? createError.message : 'Unknown error';
                  errors.push(
                    `Row ${rowNumber}: Failed to create new product (SKU: ${validation.row.sku}) - ${errorMessage}`,
                  );
                }
              }
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              Logger.error(`Error processing row ${rowNumber}`, { error: errorMessage });
              errors.push(`Row ${rowNumber}: Unexpected error processing data - ${errorMessage}`);
            }
          })();

          processingPromises.push(rowProcessingPromise);
        })
        .on('end', () => {
          void this.finalizeCSVUploadProcessing(
            processingPromises,
            recordCount,
            errors,
            () => ({ imported, updated }),
            resolve,
            reject,
          );
        });
    });
  }

  private async finalizeCSVUploadProcessing(
    processingPromises: Promise<void>[],
    recordCount: number,
    errors: string[],
    getCounts: () => { imported: number; updated: number },
    resolve: (result: { imported: number; updated: number; errors: string[] }) => void,
    reject: (reason?: unknown) => void,
  ): Promise<void> {
    try {
      await Promise.all(processingPromises);

      if (recordCount === 0) {
        errors.push('CSV file is empty or contains no valid records');
      }

      const { imported, updated } = getCounts();
      resolve({ imported, updated, errors });
    } catch (finalError: unknown) {
      Logger.error('Error in final processing', {
        error: finalError instanceof Error ? finalError.message : String(finalError),
      });
      const finalErrorMessage = finalError instanceof Error ? finalError.message : 'Unknown error';
      errors.push(`Final processing error: ${finalErrorMessage}`);
      const { imported, updated } = getCounts();
      reject({ imported, updated, errors });
    }
  }

  private async processXLSXUpload(
    filePath: string,
  ): Promise<{ imported: number; updated: number; errors: string[] }> {
    const errors: string[] = [];
    let imported = 0;
    let updated = 0;

    try {
      // Read the Excel file
      const workbook = XLSX.readFile(filePath);

      // Get the first sheet (we'll assume the user wants to import from the first sheet)
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Convert to JSON - this will preserve the original formats of all cells
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (jsonData.length < 2) {
        errors.push('XLSX file is empty or has no data rows');
        return { imported, updated, errors };
      }

      // Get headers from the first row
      const headers = jsonData[0] as string[];

      // Create a mapping of headers to their index for easier access
      const headerMap: { [key: string]: number } = {};
      headers.forEach((header, index) => {
        if (header) headerMap[header.toString().trim()] = index;
      });

      const columnState = getProductImportXlsxColumnState(headers as (string | null | undefined)[]);

      // Validate required columns exist
      if (columnState.skuColIndex === null) {
        errors.push(
          'Missing required column for SKU. Acceptable alternatives: SKU, Item Code, Reorder Number, Product Code, Item Number. Column headers are case-insensitive and leading/trailing spaces are ignored.',
        );
        return { imported, updated, errors };
      }

      if (columnState.nameColIndex === null) {
        errors.push(
          'Missing required column for Name. Acceptable alternatives: Name, Item Description, Product Name, Description, Item Name. Column headers are case-insensitive and leading/trailing spaces are ignored.',
        );
        return { imported, updated, errors };
      }

      if (columnState.costColIndex === null) {
        errors.push(
          'Missing required column for Cost. Acceptable alternatives: Cost, Cost Price, Unit Cost, Cost ex, Price, Unit Price, Cost inc, Selling Price, Retail Price. Column headers are case-insensitive and leading/trailing spaces are ignored.',
        );
        return { imported, updated, errors };
      }

      // Check for unexpected columns (not in our required or alternative columns list)
      const unexpectedColumns = getProductImportXlsxUnexpectedColumns(headers, columnState);

      if (unexpectedColumns.length > 0) {
        errors.push(`Unexpected columns found - ${unexpectedColumns.join(', ')}`);
        return { imported, updated, errors };
      }

      // Pre-load all existing products for faster lookup (avoid repeated DB queries)
      const allProducts = await this.getAllProducts();
      const productMap = new Map<string, Product>();
      const barcodeMap = new Map<string, Product>();

      for (const product of allProducts) {
        if (product.sku) {
          productMap.set(product.sku, product);
        }
        if (product.barcode) {
          barcodeMap.set(product.barcode, product);
        }
      }

      // Process each row (starting from index 1, since 0 is headers)
      for (let i = 1; i < jsonData.length; i++) {
        const row: unknown[] = jsonData[i] as unknown[];
        const recordCount = i; // Row number for error reporting

        try {
          // Get values from the appropriate columns
          const { sku, name, costStr, barcode } = getProductImportXlsxRowValues(row, columnState);
          const validation = validateProductImportRow({
            rowNumber: recordCount,
            values: { sku, name, costStr, barcode },
            unexpectedColumns: [],
          });

          if (!validation.isValid) {
            errors.push(...validation.errors);
            continue;
          }

          const operation = resolveProductImportOperation({
            sku: validation.row.sku,
            barcode: validation.row.barcode,
            bySku: productMap.get(validation.row.sku) || null,
            byBarcode: barcodeMap.get(validation.row.barcode) || null,
          });

          if (operation.type === 'conflict') {
            throw new Error(operation.error);
          }

          if (operation.type === 'update') {
            const existingProduct = operation.product;
            // Update existing product
            try {
              const updatedProduct = await this.updateProduct(existingProduct.id, {
                barcode: validation.row.barcode,
                sku: validation.row.sku, // Update SKU as well in case it changed
                name: validation.row.name,
                costPrice: validation.row.cost,
              });

              if (updatedProduct) {
                updated++;

                // Update our in-memory maps for consistency if the SKU changed
                if (existingProduct.sku !== validation.row.sku) {
                  productMap.delete(existingProduct.sku);
                  productMap.set(validation.row.sku, updatedProduct);
                }

                // Update in case the barcode changed too
                if (existingProduct.barcode !== validation.row.barcode) {
                  barcodeMap.delete(existingProduct.barcode);
                  barcodeMap.set(validation.row.barcode, updatedProduct);
                } else {
                  // Update with new record otherwise
                  barcodeMap.set(validation.row.barcode, updatedProduct);
                }
              } else {
                errors.push(
                  `Row ${recordCount}: Failed to update existing product (SKU: ${validation.row.sku})`,
                );
              }
            } catch (updateError) {
              errors.push(
                `Row ${recordCount}: Failed to update existing product (SKU: ${validation.row.sku}) - ${(updateError as Error).message}`,
              );
            }
          } else {
            // Create new product
            try {
              const newProduct = await this.createProduct({
                barcode: validation.row.barcode,
                sku: validation.row.sku,
                name: validation.row.name,
                costPrice: validation.row.cost,
              });

              if (newProduct) {
                imported++;

                // Add the new product to our in-memory maps
                if (newProduct.sku) {
                  productMap.set(newProduct.sku, newProduct);
                }
                if (newProduct.barcode) {
                  barcodeMap.set(newProduct.barcode, newProduct);
                }
              } else {
                errors.push(
                  `Row ${recordCount}: Failed to create new product (SKU: ${validation.row.sku})`,
                );
              }
            } catch (createError) {
              errors.push(
                `Row ${recordCount}: Failed to create new product (SKU: ${validation.row.sku}) - ${(createError as Error).message}`,
              );
            }
          }
        } catch (error) {
          errors.push(`Row ${recordCount}: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      errors.push(`Error processing XLSX file: ${(error as Error).message}`);
    }

    Logger.info('XLSX processing complete', { imported, updated, errors: errors.length });
    return { imported, updated, errors };
  }

  // Helper method to find column index by alternatives
  private findColumnIndexByAlternatives(
    headers: (string | null | undefined)[],
    alternatives: string[],
  ): number | null {
    return findColumnIndexByAlternatives(headers, alternatives);
  }
  private async validateCSVStructure(filePath: string): Promise<{
    isValid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];
    let isValid = true;
    return new Promise((resolve) => {
      // Create a parser that only reads the first few rows to check structure
      fs.createReadStream(filePath)
        .pipe(
          parse({
            columns: true,
            skip_empty_lines: true,
            from_line: 1, // Start from the first line (header)
            to_line: 5, // Only check the first 5 lines (header + 4 data rows)
            // Disable casting to avoid type conversion errors during validation
            cast: (value, _context) => {
              // Don't cast any values to avoid automatic type conversion
              // This ensures barcodes in scientific notation stay as strings
              return value;
            },
          }),
        )
        .on('error', (error: Error) => {
          errors.push(`CSV structure validation error: ${error.message}`);
          isValid = false;
          resolve({ isValid, errors });
        })
        .on('data', (row: Record<string, unknown>, idx: number) => {
          // Check headers on the first row (idx is the row index, starting from 0)
          if (typeof idx === 'number' && idx === 0) {
            const columnState = getProductImportCsvColumnState(row);

            // Check if all required columns are present
            if (!columnState.skuHeader) {
              errors.push(
                `Missing required column header for SKU. Acceptable alternatives: SKU, Item Code, Reorder Number, Product Code, Item Number. Column headers are case-insensitive and leading/trailing spaces are ignored.`,
              );
              isValid = false;
            }
            if (!columnState.nameHeader) {
              errors.push(
                `Missing required column header for Name. Acceptable alternatives: Name, Item Description, Product Name, Description, Item Name. Column headers are case-insensitive and leading/trailing spaces are ignored.`,
              );
              isValid = false;
            }
            if (!columnState.costHeader) {
              errors.push(
                `Missing required column header for Cost. Acceptable alternatives: Cost, Cost Price, Unit Cost, Cost ex, Price, Unit Price, Cost inc, Selling Price, Retail Price. Column headers are case-insensitive and leading/trailing spaces are ignored.`,
              );
              isValid = false;
            }
            if (!columnState.barcodeHeader) {
              errors.push(
                `Missing required column header for Barcode. Acceptable alternatives: Barcode, Alias, EAN, UPC, GTIN, Product Barcode, Barcode Number. Column headers are case-insensitive and leading/trailing spaces are ignored.`,
              );
              isValid = false;
            }
          }
        })
        .on('end', () => {
          resolve({ isValid, errors });
        });
    });
  }

  // Helper function to find the actual column name in the CSV header
  private findColumnByAlternatives(
    row: Record<string, unknown>,
    alternatives: string[],
  ): string | null {
    return findColumnByAlternatives(row, alternatives);
  }

  private async getProductBySkuOrBarcode(sku: string, barcode: string): Promise<Product | null> {
    const { bySku, byBarcode } = await this.productRepo.findBySkuOrBarcode(
      sku,
      barcode,
      this.organizationId,
    );
    const operation = resolveProductImportOperation({ sku, barcode, bySku, byBarcode });

    if (operation.type === 'conflict') {
      throw new Error(operation.error);
    }

    if (operation.type === 'create') {
      return null;
    }

    const prismaProduct = operation.product;

    return {
      id: prismaProduct.id,
      organizationId: prismaProduct.organizationId,
      barcode: prismaProduct.barcode,
      sku: prismaProduct.sku,
      name: prismaProduct.name,
      costPrice: prismaProduct.costPrice,
      createdAt: prismaProduct.createdAt.toISOString(),
      updatedAt: prismaProduct.updatedAt.toISOString(),
    };
  }
}
