import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { getOrganizationId } from '../utils/auth-bypass';
import { Product } from '../models/product.model';
import { parse } from 'csv-parse';
import * as XLSX from 'xlsx';
import fs from 'fs';
import * as path from 'path';
import { isPrismaNotFound } from '../utils/prisma-error';

// Helper function to detect file type by content
async function detectFileType(
  filePath: string,
  originalFilename?: string,
): Promise<'csv' | 'xls' | 'xlsx'> {
  // First check by original filename if provided
  if (originalFilename) {
    const ext = path.extname(originalFilename).toLowerCase();
    if (ext === '.xlsx') return 'xlsx';
    if (ext === '.xls') return 'xls';
  }

  // If we have the extension in the path, use it
  const pathExt = path.extname(filePath).toLowerCase();
  if (pathExt === '.xlsx') return 'xlsx';
  if (pathExt === '.xls') return 'xls';

  // If no extension in path (e.g., multer temp files without extension),
  // try to detect by file header
  try {
    const fileHandle = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(4);
    await fileHandle.read(buffer, 0, buffer.length, 0);
    await fileHandle.close();

    const header = buffer.toString('binary');
    if (header.startsWith('PK')) {
      // ZIP file header (XLSX files are ZIP archives)
      return 'xlsx';
    }
    // For XLS, we could also check for BIFF header, but it's more complex
    // For now, default to CSV if extension is unknown
  } catch (e) {
    console.error('Error reading file header for type detection:', e);
  }

  return 'csv'; // Default fallback
}

// ... rest of the file remains the same
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
  let cleanedStr = costStr.trim();
  let isNegative = false;

  // 1. Handle negative values in parentheses first, e.g., "(12.34)" or "$(12.34)"
  if (cleanedStr.includes('(') && cleanedStr.includes(')')) {
    const openParenIndex = cleanedStr.lastIndexOf('('); // Use last occurrence to handle cases like "$(12.34)"
    const closeParenIndex = cleanedStr.indexOf(')', openParenIndex);
    if (closeParenIndex > openParenIndex) {
      isNegative = true;
      // Extract the content inside the parentheses
      const insideParen = cleanedStr.substring(openParenIndex + 1, closeParenIndex);
      // Remove the parentheses and what's around them
      cleanedStr =
        cleanedStr.substring(0, openParenIndex) +
        insideParen +
        cleanedStr.substring(closeParenIndex + 1);
    }
  }

  // 2. Remove common currency symbols and codes (this includes currency codes like USD, EUR)
  // More comprehensive pattern to match currency symbols and codes at start or end
  cleanedStr = cleanedStr.replace(
    /([A-Z]{3,4}[\s]*)|([\s]*[A-Z]{3,4})|[\s$€£¥₹₽₪₨₩₦₡₫Є₴₵₸₺₼₾₯]/gi,
    '',
  );

  // 3. Normalize spaces (remove all spaces)
  cleanedStr = cleanedStr.trim().replace(/\s+/g, '');

  // 4. Handle explicit negative sign if not already handled by parentheses
  if (cleanedStr.startsWith('-')) {
    isNegative = true;
    cleanedStr = cleanedStr.substring(1);
  }

  // 5. Count and analyze separators to determine decimal vs. thousands
  const dotCount = (cleanedStr.match(/\./g) || []).length;
  const commaCount = (cleanedStr.match(/,/g) || []).length;

  let normalizedStr = cleanedStr;

  if (dotCount > 1 && commaCount === 0) {
    // Multiple dots, no commas (e.g. 1.000.000) -> dots are thousands separators
    // Heuristic: Check last segment length to see if it might be a decimal
    const lastDotIndex = cleanedStr.lastIndexOf('.');
    const afterLastDot = cleanedStr.substring(lastDotIndex + 1);

    if (afterLastDot.length === 2) {
      // Heuristic: 12.34.56 -> 1234.56 (last dot is decimal)
      // Replace all dots BEFORE the last one
      const part1 = cleanedStr.substring(0, lastDotIndex).replace(/\./g, '');
      normalizedStr = part1 + '.' + afterLastDot;
    } else {
      // Assume all dots are thousands separators
      normalizedStr = cleanedStr.replace(/\./g, '');
    }
  } else if (commaCount > 1 && dotCount === 0) {
    // Multiple commas, no dots (e.g. 1,000,000) -> commas are thousands separators
    normalizedStr = cleanedStr.replace(/,/g, '');
  } else if (dotCount === 0 && commaCount === 0) {
    // No separators - just digits
    normalizedStr = cleanedStr;
  } else if (dotCount === 1 && commaCount === 0) {
    // Single dot - US format (decimal)
    normalizedStr = cleanedStr;
  } else if (dotCount === 0 && commaCount === 1) {
    // Single comma - might be European decimal or thousands separator
    const commaIndex = cleanedStr.lastIndexOf(',');
    const afterComma = cleanedStr.substring(commaIndex + 1);

    // If after comma is 1-3 digits, it's likely a decimal separator
    if (/^\d{1,3}$/.test(afterComma)) {
      // European format: use comma as decimal point
      normalizedStr = cleanedStr.replace(',', '.');
    } else {
      // Thousands separator
      normalizedStr = cleanedStr.replace(/,/g, '');
    }
  } else if (commaCount === 0 && dotCount === 1) {
    // Single dot - US format (decimal)
    normalizedStr = cleanedStr;
  } else if (dotCount === 0 && commaCount === 1) {
    // Single comma - European format (decimal)
    normalizedStr = cleanedStr.replace(',', '.');
  } else {
    // Multiple separators - rightmost one is decimal separator
    const lastDotIndex = cleanedStr.lastIndexOf('.');
    const lastCommaIndex = cleanedStr.lastIndexOf(',');

    // The rightmost separator is the decimal point
    if (lastDotIndex > lastCommaIndex) {
      // Last separator is dot: US format (dot is decimal, commas are thousands)
      const integerPart = cleanedStr.substring(0, lastDotIndex).replace(/,/g, '');
      const decimalPart = cleanedStr.substring(lastDotIndex + 1);
      normalizedStr = integerPart + '.' + decimalPart;
    } else if (lastCommaIndex > lastDotIndex) {
      // Last separator is comma: European format (comma is decimal, dots are thousands)
      const integerPart = cleanedStr.substring(0, lastCommaIndex).replace(/\./g, '');
      const decimalPart = cleanedStr.substring(lastCommaIndex + 1);
      normalizedStr = integerPart + '.' + decimalPart;
    } else {
      // Both have same last index (shouldn't happen in practice with our approach)
      // Default to keeping original
      normalizedStr = cleanedStr;
    }
  }

  // Handle special case for "1,000" or "1.000" where there's no decimal part
  if (normalizedStr.match(/^[0-9]+[,.][0-9]{3}$/)) {
    // This is likely a thousands separator, not a decimal separator
    normalizedStr = normalizedStr.replace(/[,.]/, '');
  }

  // 6. Final cleanup to ensure only digits and a single dot remain
  normalizedStr = normalizedStr.replace(/[^\d.]/g, '');

  // Ensure there's only one decimal point (in case multiple were introduced)
  const parts = normalizedStr.split('.');
  if (parts.length > 2) {
    // If there are multiple decimal points, join all but the last part with no separator,
    // then add the last part as decimal
    const integerPart = parts.slice(0, -1).join('');
    const decimalPart = parts[parts.length - 1];
    normalizedStr = integerPart + '.' + decimalPart;
  }

  // Parse the value
  const value = parseFloat(normalizedStr);

  if (Number.isNaN(value)) {
    return null;
  }

  // Apply negative sign if originally detected
  return isNegative ? -value : value;
}

export class ProductService {
  private prisma: PrismaClient;
  private organizationId: string;

  /**
   * Constructor with optional dependency injection
   * @param prismaClient - Optional PrismaClient for testing/custom configurations
   * @param organizationId - Organization ID for tenant filtering (optional in tests)
   */
  constructor(prismaClient?: PrismaClient, organizationId?: string) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.organizationId = getOrganizationId(organizationId);
  }

  // Expose parser for tests that reference it via ProductService["extractCostValueEnhanced"]
  static extractCostValueEnhanced(costStr: string): number | null {
    return extractCostValueEnhanced(costStr);
  }
  async getAllProducts(limit?: number, offset?: number): Promise<Product[]> {
    const products = await this.prisma.product.findMany({
      where: {
        organizationId: this.organizationId,
      },
      ...(limit !== undefined && { take: limit }),
      ...(offset !== undefined && { skip: offset }),
    });
    return products.map(this.mapPrismaToModel);
  }

  async getProductById(id: number): Promise<Product | null> {
    const product = await this.prisma.product.findUnique({
      where: {
        id,
        organizationId: this.organizationId,
      },
    });
    return product ? this.mapPrismaToModel(product) : null;
  }

  async getProductByBarcode(barcode: string): Promise<Product | null> {
    const product = await this.prisma.product.findUnique({
      where: {
        organizationId_barcode: {
          organizationId: this.organizationId,
          barcode,
        },
      },
    });
    return product ? this.mapPrismaToModel(product) : null;
  }

  async getProductBySku(sku: string): Promise<Product | null> {
    const product = await this.prisma.product.findUnique({
      where: {
        organizationId_sku: {
          organizationId: this.organizationId,
          sku,
        },
      },
    });
    return product ? this.mapPrismaToModel(product) : null;
  }

  async createProduct(
    product: Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'organizationId'>,
  ): Promise<Product> {
    const result = await this.prisma.$transaction(async (tx) => {
      // Atomic check-and-increment to prevent TOCTOU race conditions
      const usage = await tx.organizationUsage.findUnique({
        where: { organizationId: this.organizationId },
      });

      if (!usage) {
        throw new Error('Organization usage record not found');
      }

      // Check limit BEFORE creating product (within same transaction)
      if (usage.totalSkus >= usage.maxSkus) {
        throw new Error(`SKU limit reached for this organization (${usage.maxSkus} max)`);
      }

      const newProduct = await tx.product.create({
        data: {
          barcode: product.barcode,
          sku: product.sku,
          name: product.name,
          costPrice: product.costPrice,
          organizationId: this.organizationId,
        },
      });

      // Increment organization usage counter atomically
      await tx.organizationUsage.update({
        where: { organizationId: this.organizationId },
        data: {
          totalSkus: { increment: 1 },
        },
      });

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
      const updatedProduct = await this.prisma.product.update({
        where: {
          id,
          organizationId: this.organizationId,
        },
        data: this.buildProductUpdateData(product),
      });
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
        await tx.product.delete({
          where: {
            id,
            organizationId: this.organizationId,
          },
        });

        // Decrement organization usage counter
        await tx.organizationUsage.update({
          where: { organizationId: this.organizationId },
          data: {
            totalSkus: { decrement: 1 },
          },
        });
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

  async processCSVUpload(
    filePath: string,
    originalFilename?: string,
  ): Promise<{ imported: number; updated: number; errors: string[] }> {
    const fileType = await detectFileType(filePath, originalFilename);

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
          console.error('CSV parsing error:', error);
          errors.push(`CSV parsing error: ${error.message}`);
          reject({ imported, updated, errors });
        })
        .on('data', (row) => {
          recordCount++;

          // Create a promise for each row processing to handle async operations properly
          const rowProcessingPromise = (async () => {
            try {
              // Find the correct column for each field based on alternatives
              const skuHeader = this.findColumnByAlternatives(row, [
                'SKU',
                'Item Code',
                'Reorder Number',
                'Product Code',
                'Item Number',
              ]);
              const nameHeader = this.findColumnByAlternatives(row, [
                'Name',
                'Item Description',
                'Product Name',
                'Description',
                'Item Name',
              ]);
              const costHeader = this.findColumnByAlternatives(row, [
                'Cost',
                'Cost Price',
                'Unit Cost',
                'Cost ex',
                'Price',
                'Unit Price',
                'Cost inc',
                'Selling Price',
                'Retail Price',
              ]);
              const barcodeHeader = this.findColumnByAlternatives(row, [
                'Barcode',
                'Alias',
                'EAN',
                'UPC',
                'GTIN',
                'Product Barcode',
                'Barcode Number',
              ]);

              // Validate required fields - check if headers exist before accessing
              const sku = skuHeader ? row[skuHeader]?.toString()?.trim() : null;
              const name = nameHeader ? row[nameHeader]?.toString()?.trim() : null;
              const costStr = costHeader ? row[costHeader]?.toString()?.trim() : null;
              const barcode = barcodeHeader ? row[barcodeHeader]?.toString()?.trim() : null;

              // Check if all required fields are present
              if (!sku) {
                errors.push(
                  `Row ${recordCount}: Missing required field - SKU. Please ensure the column exists and contains a value.`,
                );
              }
              if (!name) {
                errors.push(
                  `Row ${recordCount}: Missing required field - Name. Please ensure the column exists and contains a value.`,
                );
              }
              if (!costStr) {
                errors.push(
                  `Row ${recordCount}: Missing required field - Cost. Please ensure the column exists and contains a numeric value (e.g., '12.99', '$12.99', or 'EUR 12.99').`,
                );
              }
              if (!barcode) {
                errors.push(
                  `Row ${recordCount}: Missing required field - Barcode. Please ensure the column exists and contains a value.`,
                );
              }

              // If any required field is missing, skip processing this row
              if (!sku || !name || !costStr || !barcode) {
                return;
              }

              // Validate data type for cost (should be a valid number)
              // Handle cost values with currency symbols using the helper function
              const cost = extractCostValueEnhanced(costStr);
              if (cost === null) {
                errors.push(
                  `Row ${recordCount}: Invalid cost value - "${costStr}". Cost can be a positive or negative number. Acceptable formats include: '12.99', '$12.99', '€15.50', '(10.99)' for negative values, '1,234.56', '1.234,56' (European format).`,
                );
                return;
              }

              // Additional validations
              if (sku.length > 100) {
                errors.push(
                  `Row ${recordCount}: SKU too long (max 100 characters) - "${sku.substring(0, 50)}...". Please ensure the SKU value is 100 characters or fewer.`,
                );
                return;
              }

              if (name.length > 200) {
                errors.push(
                  `Row ${recordCount}: Name too long (max 200 characters) - "${name.substring(0, 50)}...". Please ensure the Name value is 200 characters or fewer.`,
                );
                return;
              }

              if (barcode.length > 100) {
                errors.push(
                  `Row ${recordCount}: Barcode too long (max 100 characters) - "${barcode.substring(0, 50)}...". Please ensure the Barcode value is 100 characters or fewer.`,
                );
                return;
              }

              // Verify that all required fields were found
              if (!skuHeader) {
                errors.push(
                  `Row ${recordCount}: Could not find required column - SKU (alternatives: SKU, Item Code, Reorder Number, Product Code, Item Number)`,
                );
                return;
              }
              if (!nameHeader) {
                errors.push(
                  `Row ${recordCount}: Could not find required column - Name (alternatives: Name, Item Description, Product Name, Description, Item Name)`,
                );
                return;
              }
              if (!costHeader) {
                errors.push(
                  `Row ${recordCount}: Could not find required column - Cost (alternatives: Cost, Cost Price, Unit Cost, Cost ex, Price, Unit Price, Cost inc, Selling Price, Retail Price)`,
                );
                return;
              }
              if (!barcodeHeader) {
                errors.push(
                  `Row ${recordCount}: Could not find required column - Barcode (alternatives: Barcode, Alias, EAN, UPC, GTIN, Product Barcode, Barcode Number)`,
                );
                return;
              }

              // Check for unexpected columns (not in our required or alternative columns list)
              const allowedHeaders = [
                skuHeader,
                nameHeader,
                costHeader,
                barcodeHeader,
                ...['SKU', 'Item Code', 'Reorder Number', 'Product Code', 'Item Number'],
                ...['Name', 'Item Description', 'Product Name', 'Description', 'Item Name'],
                ...[
                  'Cost',
                  'Cost Price',
                  'Unit Cost',
                  'Cost ex',
                  'Price',
                  'Unit Price',
                  'Cost inc',
                  'Selling Price',
                  'Retail Price',
                ],
                ...['Barcode', 'Alias', 'EAN', 'UPC', 'GTIN', 'Product Barcode', 'Barcode Number'],
              ]
                .map((header) => header?.toLowerCase())
                .filter(Boolean);

              const allowedColumns = new Set(allowedHeaders);

              const unexpectedColumns = Object.keys(row).filter(
                (col) => !allowedColumns.has(col.toLowerCase()),
              );

              if (unexpectedColumns.length > 0) {
                errors.push(
                  `Row ${recordCount}: Unexpected columns found - ${unexpectedColumns.join(', ')}`,
                );
                return; // Skip processing this row if there are unexpected columns
              }

              // Check if product already exists (by SKU or Barcode)
              let existingProduct: Product | null = null;
              try {
                existingProduct = await this.getProductBySkuOrBarcode(sku, barcode);
              } catch (duplicateError: unknown) {
                const errorMessage =
                  duplicateError instanceof Error ? duplicateError.message : 'Unknown error';
                errors.push(`Row ${recordCount}: ${errorMessage}`);
                return; // Skip processing this row
              }

              if (existingProduct) {
                // Update existing product
                try {
                  await this.updateProduct(existingProduct.id, {
                    barcode,
                    sku, // Update SKU as well in case it changed
                    name,
                    costPrice: cost,
                  });
                  updated++;
                } catch (updateError: unknown) {
                  const errorMessage =
                    updateError instanceof Error ? updateError.message : 'Unknown error';
                  errors.push(
                    `Row ${recordCount}: Failed to update existing product (SKU: ${sku}) - ${errorMessage}`,
                  );
                }
              } else {
                // Create new product
                try {
                  await this.createProduct({
                    barcode,
                    sku,
                    name,
                    costPrice: cost,
                  });
                  imported++;
                } catch (createError: unknown) {
                  const errorMessage =
                    createError instanceof Error ? createError.message : 'Unknown error';
                  errors.push(
                    `Row ${recordCount}: Failed to create new product (SKU: ${sku}) - ${errorMessage}`,
                  );
                }
              }
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              console.error(`Error processing row ${recordCount}:`, error);
              errors.push(`Row ${recordCount}: Unexpected error processing data - ${errorMessage}`);
            }
          })();

          processingPromises.push(rowProcessingPromise);
        })
        .on('end', async () => {
          try {
            // Wait for all row processing promises to complete
            await Promise.all(processingPromises);

            if (recordCount === 0) {
              errors.push('CSV file is empty or contains no valid records');
            }

            resolve({ imported, updated, errors });
          } catch (finalError: unknown) {
            console.error('Error in final processing:', finalError);
            const finalErrorMessage =
              finalError instanceof Error ? finalError.message : 'Unknown error';
            errors.push(`Final processing error: ${finalErrorMessage}`);
            reject({ imported, updated, errors });
          }
        });
    });
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

      // Find the required column indices based on alternatives
      const skuColIndex = this.findColumnIndexByAlternatives(
        headers as (string | null | undefined)[],
        ['SKU', 'Item Code', 'Reorder Number', 'Product Code', 'Item Number'],
      );
      const nameColIndex = this.findColumnIndexByAlternatives(
        headers as (string | null | undefined)[],
        ['Name', 'Item Description', 'Product Name', 'Description', 'Item Name'],
      );
      const costColIndex = this.findColumnIndexByAlternatives(
        headers as (string | null | undefined)[],
        [
          'Cost',
          'Cost Price',
          'Unit Cost',
          'Cost ex',
          'Price',
          'Unit Price',
          'Cost inc',
          'Selling Price',
          'Retail Price',
        ],
      );
      const barcodeColIndex = this.findColumnIndexByAlternatives(
        headers as (string | null | undefined)[],
        ['Barcode', 'Alias', 'EAN', 'UPC', 'GTIN', 'Product Barcode', 'Barcode Number'],
      );

      // Validate required columns exist
      if (skuColIndex === null) {
        errors.push(
          'Missing required column for SKU. Acceptable alternatives: SKU, Item Code, Reorder Number, Product Code, Item Number. Column headers are case-insensitive and leading/trailing spaces are ignored.',
        );
        return { imported, updated, errors };
      }

      if (nameColIndex === null) {
        errors.push(
          'Missing required column for Name. Acceptable alternatives: Name, Item Description, Product Name, Description, Item Name. Column headers are case-insensitive and leading/trailing spaces are ignored.',
        );
        return { imported, updated, errors };
      }

      if (costColIndex === null) {
        errors.push(
          'Missing required column for Cost. Acceptable alternatives: Cost, Cost Price, Unit Cost, Cost ex, Price, Unit Price, Cost inc, Selling Price, Retail Price. Column headers are case-insensitive and leading/trailing spaces are ignored.',
        );
        return { imported, updated, errors };
      }

      // Check for unexpected columns (not in our required or alternative columns list)
      const allowedHeaders = [
        skuColIndex !== null ? headers[skuColIndex] : null,
        nameColIndex !== null ? headers[nameColIndex] : null,
        costColIndex !== null ? headers[costColIndex] : null,
        barcodeColIndex !== null ? headers[barcodeColIndex] : null,
        ...['SKU', 'Item Code', 'Reorder Number', 'Product Code', 'Item Number'],
        ...['Name', 'Item Description', 'Product Name', 'Description', 'Item Name'],
        ...[
          'Cost',
          'Cost Price',
          'Unit Cost',
          'Cost ex',
          'Price',
          'Unit Price',
          'Cost inc',
          'Selling Price',
          'Retail Price',
        ],
        ...['Barcode', 'Alias', 'EAN', 'UPC', 'GTIN', 'Product Barcode', 'Barcode Number'],
      ]
        .filter((header): header is string => header !== null && header !== undefined)
        .map((header) => header.toLowerCase());

      const allowedColumns = new Set(allowedHeaders);

      const unexpectedColumns = headers.filter((header, _index) => {
        if (!header) return false;
        return !allowedColumns.has(header.toString().toLowerCase());
      });

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
          const sku =
            skuColIndex !== null && skuColIndex < row.length && row[skuColIndex] !== undefined
              ? row[skuColIndex]?.toString()?.trim()
              : null;
          const name =
            nameColIndex !== null && nameColIndex < row.length && row[nameColIndex] !== undefined
              ? row[nameColIndex]?.toString()?.trim()
              : null;
          const costStr =
            costColIndex !== null && costColIndex < row.length && row[costColIndex] !== undefined
              ? row[costColIndex]?.toString()?.trim()
              : null;
          const barcode =
            barcodeColIndex !== null &&
            barcodeColIndex < row.length &&
            row[barcodeColIndex] !== undefined
              ? row[barcodeColIndex]?.toString()?.trim()
              : null;

          // Check if all required fields are present
          if (!sku) {
            errors.push(
              `Row ${recordCount}: Missing required field - SKU. Please ensure the column exists and contains a value.`,
            );
          }
          if (!name) {
            errors.push(
              `Row ${recordCount}: Missing required field - Name. Please ensure the column exists and contains a value.`,
            );
          }
          if (!costStr) {
            errors.push(
              `Row ${recordCount}: Missing required field - Cost. Please ensure the column exists and contains a numeric value (e.g., '12.99', '$12.99', or 'EUR 12.99').`,
            );
          }
          if (!barcode) {
            errors.push(
              `Row ${recordCount}: Missing required field - Barcode. Please ensure the column exists and contains a value.`,
            );
          }

          // If any required field is missing, skip processing this row
          if (!sku || !name || !costStr || !barcode) {
            continue;
          }

          // Validate data type for cost (should be a valid number)
          // Handle cost values with currency symbols using the helper function
          const cost = extractCostValueEnhanced(costStr);
          if (cost === null) {
            errors.push(
              `Row ${recordCount}: Invalid cost value - \\\"${costStr}\\\". Cost can be a positive or negative number. Acceptable formats include: '12.99', '$12.99', '€15.50', '(10.99)' for negative values, '1,234.56', '1.234,56' (European format).`,
            );
            continue;
          }

          // Additional validations
          if (sku.length > 100) {
            errors.push(
              `Row ${recordCount}: SKU too long (max 100 characters) - \\\"${sku.substring(0, 50)}...\\\". Please ensure the SKU value is 100 characters or fewer.`,
            );
            continue;
          }

          if (name.length > 200) {
            errors.push(
              `Row ${recordCount}: Name too long (max 200 characters) - \\\"${name.substring(0, 50)}...\\\". Please ensure the Name value is 200 characters or fewer.`,
            );
            continue;
          }

          if (barcode.length > 100) {
            errors.push(
              `Row ${recordCount}: Barcode too long (max 100 characters) - \\\"${barcode.substring(0, 50)}...\\\". Please ensure the Barcode value is 100 characters or fewer.`,
            );
            continue;
          }

          // Check if a product with this SKU or Barcode already exists using in-memory lookup
          let existingProduct: Product | null = null;

          if (sku) {
            existingProduct = productMap.get(sku) || null;
          }

          if (!existingProduct && barcode) {
            existingProduct = barcodeMap.get(barcode) || null;
          }

          // If both SKU and barcode are found but they refer to different products, that's an error
          const skuProduct = sku ? productMap.get(sku) || null : null;
          const barcodeProduct = barcode ? barcodeMap.get(barcode) || null : null;

          if (skuProduct && barcodeProduct && skuProduct.id !== barcodeProduct.id) {
            throw new Error(
              `Duplicate identifiers detected: SKU ${sku} exists in product ${skuProduct.id} and barcode ${barcode} exists in product ${barcodeProduct.id}. This will cause data integrity issues.`,
            );
          }

          if (existingProduct) {
            // Update existing product
            try {
              const updatedProduct = await this.updateProduct(existingProduct.id, {
                barcode,
                sku, // Update SKU as well in case it changed
                name,
                costPrice: cost,
              });

              if (updatedProduct) {
                updated++;

                // Update our in-memory maps for consistency if the SKU changed
                if (existingProduct.sku !== sku) {
                  productMap.delete(existingProduct.sku);
                  productMap.set(sku, updatedProduct);
                }

                // Update in case the barcode changed too
                if (existingProduct.barcode !== barcode) {
                  barcodeMap.delete(existingProduct.barcode);
                  barcodeMap.set(barcode, updatedProduct);
                } else {
                  // Update with new record otherwise
                  barcodeMap.set(barcode, updatedProduct);
                }
              } else {
                errors.push(`Row ${recordCount}: Failed to update existing product (SKU: ${sku})`);
              }
            } catch (updateError) {
              errors.push(
                `Row ${recordCount}: Failed to update existing product (SKU: ${sku}) - ${(updateError as Error).message}`,
              );
            }
          } else {
            // Create new product
            try {
              const newProduct = await this.createProduct({
                barcode,
                sku,
                name,
                costPrice: cost,
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
                errors.push(`Row ${recordCount}: Failed to create new product (SKU: ${sku})`);
              }
            } catch (createError) {
              errors.push(
                `Row ${recordCount}: Failed to create new product (SKU: ${sku}) - ${(createError as Error).message}`,
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

    console.log(
      `XLSX processing complete: ${imported} imported, ${updated} updated, ${errors.length} errors`,
    );
    return { imported, updated, errors };
  }

  // Helper method to find column index by alternatives
  private findColumnIndexByAlternatives(
    headers: (string | null | undefined)[],
    alternatives: string[],
  ): number | null {
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      if (!header) continue;
      const cleanHeader = header.toString().trim().toLowerCase();
      for (const alt of alternatives) {
        if (cleanHeader === alt.toLowerCase()) {
          return i;
        }
      }
    }
    return null;
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
            // Find the required columns using alternative names
            const skuHeader = this.findColumnByAlternatives(row, [
              'SKU',
              'Item Code',
              'Reorder Number',
              'Product Code',
              'Item Number',
            ]);
            const nameHeader = this.findColumnByAlternatives(row, [
              'Name',
              'Item Description',
              'Product Name',
              'Description',
              'Item Name',
            ]);
            const costHeader = this.findColumnByAlternatives(row, [
              'Cost',
              'Cost Price',
              'Unit Cost',
              'Cost ex',
              'Price',
              'Unit Price',
              'Cost inc',
              'Selling Price',
              'Retail Price',
            ]);
            const barcodeHeader = this.findColumnByAlternatives(row, [
              'Barcode',
              'Alias',
              'EAN',
              'UPC',
              'GTIN',
              'Product Barcode',
              'Barcode Number',
            ]);

            // Check if all required columns are present
            if (!skuHeader) {
              errors.push(
                `Missing required column header for SKU. Acceptable alternatives: SKU, Item Code, Reorder Number, Product Code, Item Number. Column headers are case-insensitive and leading/trailing spaces are ignored.`,
              );
              isValid = false;
            }
            if (!nameHeader) {
              errors.push(
                `Missing required column header for Name. Acceptable alternatives: Name, Item Description, Product Name, Description, Item Name. Column headers are case-insensitive and leading/trailing spaces are ignored.`,
              );
              isValid = false;
            }
            if (!costHeader) {
              errors.push(
                `Missing required column header for Cost. Acceptable alternatives: Cost, Cost Price, Unit Cost, Cost ex, Price, Unit Price, Cost inc, Selling Price, Retail Price. Column headers are case-insensitive and leading/trailing spaces are ignored.`,
              );
              isValid = false;
            }
            if (!barcodeHeader) {
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
    const headers = Object.keys(row);

    for (const alt of alternatives) {
      // Case insensitive search
      const foundHeader = headers.find((header) => header.toLowerCase() === alt.toLowerCase());
      if (foundHeader) {
        return foundHeader;
      }
    }

    return null;
  }

  private async getProductBySkuOrBarcode(sku: string, barcode: string): Promise<Product | null> {
    // Check for products by SKU and barcode independently within the organization
    const bySku = await this.prisma.product.findUnique({
      where: {
        organizationId_sku: {
          organizationId: this.organizationId,
          sku,
        },
      },
    });

    const byBarcode = await this.prisma.product.findUnique({
      where: {
        organizationId_barcode: {
          organizationId: this.organizationId,
          barcode,
        },
      },
    });

    // If both match different products, this is an error case
    if (bySku && byBarcode && bySku.id !== byBarcode.id) {
      throw new Error(
        `Duplicate identifiers detected: SKU ${sku} exists in product ${bySku.id} and barcode ${barcode} exists in product ${byBarcode.id}. This will cause data integrity issues.`,
      );
    }

    // Return the product found by either SKU or barcode (or null if neither)
    const product = bySku || byBarcode;
    return product ? this.mapPrismaToModel(product) : null;
  }
}
