"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductService = void 0;
exports.extractCostValue = extractCostValue;
exports.extractCostValueEnhanced = extractCostValueEnhanced;
const database_1 = require("../database");
const csv_parse_1 = require("csv-parse");
const XLSX = __importStar(require("xlsx"));
const fs_1 = __importDefault(require("fs"));
const path = __importStar(require("path"));
// Helper function to detect file type by content
function detectFileType(filePath, originalFilename) {
    // First check by original filename if provided
    if (originalFilename) {
        const ext = path.extname(originalFilename).toLowerCase();
        if (ext === '.xlsx')
            return 'xlsx';
        if (ext === '.xls')
            return 'xls';
    }
    // If we have the extension in the path, use it
    const pathExt = path.extname(filePath).toLowerCase();
    if (pathExt === '.xlsx')
        return 'xlsx';
    if (pathExt === '.xls')
        return 'xls';
    // If no extension in path (e.g., multer temp files without extension), 
    // try to detect by file header
    try {
        const header = fs_1.default.readFileSync(filePath, { encoding: 'binary', flag: 'r' });
        if (header.startsWith('PK')) { // ZIP file header (XLSX files are ZIP archives)
            return 'xlsx';
        }
        // For XLS, we could also check for BIFF header, but it's more complex
        // For now, default to CSV if extension is unknown
    }
    catch (e) {
        console.error('Error reading file header for type detection:', e);
    }
    return 'csv'; // Default fallback
}
// ... rest of the file remains the same
function extractCostValue(costStr) {
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
    }
    else if (commaCount === 1) {
        // Single comma - check if it's followed by 1-2 digits (likely decimal separator)
        if (cleanedStr.match(/,\d{1,2}$/)) {
            cleanedStr = cleanedStr.replace(/,/, '.');
        }
        else {
            // Otherwise treat comma as thousands separator
            cleanedStr = cleanedStr.replace(/,/, '');
        }
    }
    // Now parse as float
    const value = parseFloat(cleanedStr);
    if (isNaN(value)) {
        return null;
    }
    return value;
}
// Helper function to normalize numeric strings by handling various currency symbols, spaces, and formatting
function normalizeNumericString(input) {
    // Remove common currency symbols at the beginning or end, including additional ones
    let cleaned = input.trim();
    // More comprehensive currency symbol removal
    cleaned = cleaned.replace(/^[¥€£¢₹₽₪₨₩₦₡₫Є₴₵₸₺₼₾₯]/, '');
    cleaned = cleaned.replace(/[¥€£¢₹₽₪₨₩₦₡₫Є₴₵₸₺₼₾₯]$/, '');
    // Remove additional formatting like parentheses (often used for negative values) temporarily
    // and other common characters that might indicate currency or formatting
    if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
        cleaned = cleaned.substring(1, cleaned.length - 1);
    }
    // Remove common thousands separators and spaces
    // Keep only digits, decimal points, and commas temporarily for format analysis
    cleaned = cleaned.replace(/[ ]/g, ''); // Remove any spaces first
    return cleaned;
}
// Enhanced helper function to extract numeric value from cost string with flexible formatting
function extractCostValueEnhanced(costStr) {
    // Remove common currency symbols and formatting
    let cleanedStr = costStr.trim();
    // Check if the value is in parentheses (indicates negative)
    let isNegative = false;
    if (cleanedStr.startsWith('(') && cleanedStr.endsWith(')')) {
        isNegative = true;
        cleanedStr = cleanedStr.substring(1, cleanedStr.length - 1);
    }
    // Remove common currency symbols at the beginning or end
    cleanedStr = cleanedStr.replace(/^[\$€£¥₹₽₪₨]/, ''); // Remove common currency symbols from start
    cleanedStr = cleanedStr.replace(/[\$€£¥₹₽₪₨]$/, ''); // Remove common currency symbols from end
    // Remove any other non-numeric characters except decimal point and comma (for thousands)
    // Keep only digits, decimal point, and comma
    cleanedStr = cleanedStr.replace(/[^\d.,]/g, '');
    // Handle different decimal/thousands separator conventions
    const commaCount = (cleanedStr.match(/,/g) || []).length;
    const dotCount = (cleanedStr.match(/\./g) || []).length;
    // Determine the most likely decimal separator based on format
    // European format: 1.234,56 (dots for thousands, comma for decimal)
    // US format: 1,234.56 (comma for thousands, dot for decimal)
    // We'll assume that the rightmost occurrence of either comma or dot as decimal separator
    if (commaCount > 0 && dotCount > 0) {
        // If both exist, check which one is at the end (likely decimal separator)
        const endsWithDigitPattern = /\d{1,2}$/;
        if (cleanedStr.includes(',') && endsWithDigitPattern.test(cleanedStr)) {
            // Check if string ends with comma followed by 1-2 digits (European format)
            const europeanPattern = /,\d{1,2}$/;
            if (europeanPattern.test(cleanedStr)) {
                // European format: swap meaning - commas are thousands, last dot is decimal
                cleanedStr = cleanedStr.replace(/\./g, ''); // Remove dots (thousands separators)
                cleanedStr = cleanedStr.replace(/,/, '.'); // Replace last comma with dot (decimal)
            }
            else {
                // US format: commas are thousands, last dot is decimal
                cleanedStr = cleanedStr.replace(/,/g, ''); // Remove commas (thousands separators)
            }
        }
        else if (cleanedStr.includes('.') && endsWithDigitPattern.test(cleanedStr)) {
            // Check if string ends with dot followed by 1-2 digits (US format)
            const usPattern = /\.\\d{1,2}$/;
            if (usPattern.test(cleanedStr)) {
                // US format: commas are thousands, last dot is decimal
                cleanedStr = cleanedStr.replace(/,/g, ''); // Remove commas (thousands separators)
            }
            else {
                // For other patterns, default to US format
                cleanedStr = cleanedStr.replace(/,/g, ''); // Remove commas (thousands separators)
            }
        }
        else {
            // Default to US format: commas as thousands separators
            cleanedStr = cleanedStr.replace(/,/g, ''); // Remove commas (thousands separators)
        }
    }
    else if (commaCount > 1) {
        // Multiple commas - assume thousands separators (US format)
        cleanedStr = cleanedStr.replace(/,/g, ''); // Remove all commas
    }
    else if (commaCount === 1) {
        // Single comma - check if followed by 1-2 digits (likely decimal separator)
        if (cleanedStr.match(/,\d{1,2}$/)) {
            cleanedStr = cleanedStr.replace(/,/, '.'); // Replace comma with dot (decimal)
        }
        else {
            // Otherwise treat as thousands separator
            cleanedStr = cleanedStr.replace(/,/, ''); // Remove comma (thousands separator)
        }
    }
    else if (dotCount > 1) {
        // Multiple dots - assume thousands separators
        cleanedStr = cleanedStr.replace(/\.(?=.*\.)/g, ''); // Remove all but last dot
    }
    // Now parse as float
    const value = parseFloat(cleanedStr);
    if (isNaN(value)) {
        return null;
    }
    // Apply negative sign if originally detected
    return isNegative ? -value : value;
}
// Helper function to validate and format error messages
function formatErrorMessage(rowNumber, field, value, expected) {
    return `Row ${rowNumber}: Invalid ${field} value "${value}". Expected ${expected}.`;
}
class ProductService {
    async getAllProducts() {
        const db = await (0, database_1.getDb)();
        return db.all("SELECT * FROM products");
    }
    async getProductById(id) {
        const db = await (0, database_1.getDb)();
        const product = await db.get("SELECT * FROM products WHERE id = ?", id);
        return product || null;
    }
    async getProductByBarcode(barcode) {
        const db = await (0, database_1.getDb)();
        const product = await db.get("SELECT * FROM products WHERE barcode = ?", barcode);
        return product || null;
    }
    async getProductBySku(sku) {
        const db = await (0, database_1.getDb)();
        const product = await db.get("SELECT * FROM products WHERE sku = ?", sku);
        return product || null;
    }
    async createProduct(product) {
        const db = await (0, database_1.getDb)();
        const result = await db.run("INSERT INTO products (barcode, sku, name, cost_price) VALUES (?, ?, ?, ?)", product.barcode, product.sku, product.name, product.costPrice);
        const newProduct = {
            id: result.lastID,
            ...product,
            createdAt: new Date().toISOString(), // SQLite handles this with DEFAULT CURRENT_TIMESTAMP
            updatedAt: new Date().toISOString(), // SQLite handles this with DEFAULT CURRENT_TIMESTAMP
        };
        return newProduct;
    }
    async updateProduct(id, product) {
        const db = await (0, database_1.getDb)();
        const fields = Object.keys(product);
        if (fields.length === 0) {
            return null;
        }
        // Map TypeScript field names to database column names
        const fieldToColumnMap = {
            costPrice: 'cost_price',
            // Add other mappings if needed in the future
        };
        const setClause = fields.map((field) => `${fieldToColumnMap[field] || field} = ?`).join(", ");
        const values = [...Object.values(product), id];
        const result = await db.run(`UPDATE products SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, ...values);
        if ((result.changes ?? 0) === 0) {
            return null;
        }
        // Return the updated product
        const updatedProduct = await this.getProductById(id);
        return updatedProduct;
    }
    async deleteProduct(id) {
        const db = await (0, database_1.getDb)();
        const result = await db.run("DELETE FROM products WHERE id = ?", id);
        return (result.changes ?? 0) > 0;
    }
    async processCSVUpload(filePath, originalFilename) {
        const fileType = detectFileType(filePath, originalFilename);
        if (fileType === 'xlsx' || fileType === 'xls') {
            return this.processXLSXUpload(filePath);
        }
        else {
            return this.processCSVUploadInternal(filePath);
        }
    }
    async processCSVUploadInternal(filePath) {
        const errors = [];
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
            const processingPromises = [];
            const parser = fs_1.default.createReadStream(filePath)
                .pipe((0, csv_parse_1.parse)({
                columns: true, // Use auto-generated columns from header row
                skip_empty_lines: true,
                // Add additional CSV validation options
                skip_records_with_error: true, // Skip records that cause errors
                cast: (value, context) => {
                    // Don't cast any values to avoid automatic type conversion
                    // This ensures barcodes in scientific notation stay as strings
                    return value;
                },
            }))
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
                        const skuHeader = this.findColumnByAlternatives(row, ['SKU', 'Item Code', 'Reorder Number', 'Product Code', 'Item Number']);
                        const nameHeader = this.findColumnByAlternatives(row, ['Name', 'Item Description', 'Product Name', 'Description', 'Item Name']);
                        const costHeader = this.findColumnByAlternatives(row, ['Cost', 'Cost Price', 'Unit Cost', 'Cost ex', 'Price', 'Unit Price', 'Cost inc', 'Selling Price', 'Retail Price']);
                        const barcodeHeader = this.findColumnByAlternatives(row, ['Barcode', 'Alias', 'EAN', 'UPC', 'GTIN', 'Product Barcode', 'Barcode Number']);
                        // Validate required fields - check if headers exist before accessing
                        const sku = skuHeader ? row[skuHeader]?.toString()?.trim() : null;
                        const name = nameHeader ? row[nameHeader]?.toString()?.trim() : null;
                        const costStr = costHeader ? row[costHeader]?.toString()?.trim() : null;
                        const barcode = barcodeHeader ? row[barcodeHeader]?.toString()?.trim() : null;
                        // Check if all required fields are present
                        if (!sku) {
                            errors.push(`Row ${recordCount}: Missing required field - SKU. Please ensure the column exists and contains a value.`);
                        }
                        if (!name) {
                            errors.push(`Row ${recordCount}: Missing required field - Name. Please ensure the column exists and contains a value.`);
                        }
                        if (!costStr) {
                            errors.push(`Row ${recordCount}: Missing required field - Cost. Please ensure the column exists and contains a numeric value (e.g., '12.99', '$12.99', or 'EUR 12.99').`);
                        }
                        if (!barcode) {
                            errors.push(`Row ${recordCount}: Missing required field - Barcode. Please ensure the column exists and contains a value.`);
                        }
                        // If any required field is missing, skip processing this row
                        if (!sku || !name || !costStr || !barcode) {
                            return;
                        }
                        // Validate data type for cost (should be a valid number)
                        // Handle cost values with currency symbols using the helper function
                        const cost = extractCostValueEnhanced(costStr);
                        if (cost === null) {
                            errors.push(`Row ${recordCount}: Invalid cost value - "${costStr}". Cost can be a positive or negative number. Acceptable formats include: '12.99', '$12.99', '€15.50', '(10.99)' for negative values, '1,234.56', '1.234,56' (European format).`);
                            return;
                        }
                        // Additional validations
                        if (sku.length > 100) {
                            errors.push(`Row ${recordCount}: SKU too long (max 100 characters) - "${sku.substring(0, 50)}...". Please ensure the SKU value is 100 characters or fewer.`);
                            return;
                        }
                        if (name.length > 200) {
                            errors.push(`Row ${recordCount}: Name too long (max 200 characters) - "${name.substring(0, 50)}...". Please ensure the Name value is 200 characters or fewer.`);
                            return;
                        }
                        if (barcode.length > 100) {
                            errors.push(`Row ${recordCount}: Barcode too long (max 100 characters) - "${barcode.substring(0, 50)}...". Please ensure the Barcode value is 100 characters or fewer.`);
                            return;
                        }
                        // Verify that all required fields were found
                        if (!skuHeader) {
                            errors.push(`Row ${recordCount}: Could not find required column - SKU (alternatives: SKU, Item Code, Reorder Number, Product Code, Item Number)`);
                            return;
                        }
                        if (!nameHeader) {
                            errors.push(`Row ${recordCount}: Could not find required column - Name (alternatives: Name, Item Description, Product Name, Description, Item Name)`);
                            return;
                        }
                        if (!costHeader) {
                            errors.push(`Row ${recordCount}: Could not find required column - Cost (alternatives: Cost, Cost Price, Unit Cost, Cost ex, Price, Unit Price, Cost inc, Selling Price, Retail Price)`);
                            return;
                        }
                        if (!barcodeHeader) {
                            errors.push(`Row ${recordCount}: Could not find required column - Barcode (alternatives: Barcode, Alias, EAN, UPC, GTIN, Product Barcode, Barcode Number)`);
                            return;
                        }
                        // Check for unexpected columns (not in our required or alternative columns list)
                        const allowedHeaders = [
                            skuHeader, nameHeader, costHeader, barcodeHeader,
                            ...['SKU', 'Item Code', 'Reorder Number', 'Product Code', 'Item Number'],
                            ...['Name', 'Item Description', 'Product Name', 'Description', 'Item Name'],
                            ...['Cost', 'Cost Price', 'Unit Cost', 'Cost ex', 'Price', 'Unit Price', 'Cost inc', 'Selling Price', 'Retail Price'],
                            ...['Barcode', 'Alias', 'EAN', 'UPC', 'GTIN', 'Product Barcode', 'Barcode Number']
                        ].map(header => header?.toLowerCase()).filter(Boolean);
                        const allowedColumns = new Set(allowedHeaders);
                        const unexpectedColumns = Object.keys(row).filter(col => !allowedColumns.has(col.toLowerCase()));
                        if (unexpectedColumns.length > 0) {
                            errors.push(`Row ${recordCount}: Unexpected columns found - ${unexpectedColumns.join(', ')}`);
                            return; // Skip processing this row if there are unexpected columns
                        }
                        // Check if product already exists (by SKU or Barcode)
                        let existingProduct = null;
                        try {
                            existingProduct = await this.getProductBySkuOrBarcode(sku, barcode);
                        }
                        catch (duplicateError) {
                            errors.push(`Row ${recordCount}: ${duplicateError.message}`);
                            return; // Skip processing this row
                        }
                        if (existingProduct) {
                            // Update existing product
                            try {
                                await this.updateProduct(existingProduct.id, {
                                    barcode,
                                    sku, // Update SKU as well in case it changed
                                    name,
                                    costPrice: cost
                                });
                                updated++;
                            }
                            catch (updateError) {
                                errors.push(`Row ${recordCount}: Failed to update existing product (SKU: ${sku}) - ${updateError.message}`);
                            }
                        }
                        else {
                            // Create new product
                            try {
                                await this.createProduct({
                                    barcode,
                                    sku,
                                    name,
                                    costPrice: cost
                                });
                                imported++;
                            }
                            catch (createError) {
                                errors.push(`Row ${recordCount}: Failed to create new product (SKU: ${sku}) - ${createError.message}`);
                            }
                        }
                    }
                    catch (error) {
                        console.error(`Error processing row ${recordCount}:`, error);
                        errors.push(`Row ${recordCount}: Unexpected error processing data - ${error.message}`);
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
                }
                catch (finalError) {
                    console.error('Error in final processing:', finalError);
                    errors.push(`Final processing error: ${finalError.message}`);
                    reject({ imported, updated, errors });
                }
            });
        });
    }
    async processXLSXUpload(filePath) {
        const errors = [];
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
            const headers = jsonData[0];
            // Create a mapping of headers to their index for easier access
            const headerMap = {};
            headers.forEach((header, index) => {
                if (header)
                    headerMap[header.toString().trim()] = index;
            });
            // Find the required column indices based on alternatives
            const skuColIndex = this.findColumnIndexByAlternatives(headers, ['SKU', 'Item Code', 'Reorder Number', 'Product Code', 'Item Number']);
            const nameColIndex = this.findColumnIndexByAlternatives(headers, ['Name', 'Item Description', 'Product Name', 'Description', 'Item Name']);
            const costColIndex = this.findColumnIndexByAlternatives(headers, ['Cost', 'Cost Price', 'Unit Cost', 'Cost ex', 'Price', 'Unit Price', 'Cost inc', 'Selling Price', 'Retail Price']);
            const barcodeColIndex = this.findColumnIndexByAlternatives(headers, ['Barcode', 'Alias', 'EAN', 'UPC', 'GTIN', 'Product Barcode', 'Barcode Number']);
            // Validate required columns exist
            if (skuColIndex === null) {
                errors.push('Missing required column for SKU. Acceptable alternatives: SKU, Item Code, Reorder Number, Product Code, Item Number. Column headers are case-insensitive and leading/trailing spaces are ignored.');
                return { imported, updated, errors };
            }
            if (nameColIndex === null) {
                errors.push('Missing required column for Name. Acceptable alternatives: Name, Item Description, Product Name, Description, Item Name. Column headers are case-insensitive and leading/trailing spaces are ignored.');
                return { imported, updated, errors };
            }
            if (costColIndex === null) {
                errors.push('Missing required column for Cost. Acceptable alternatives: Cost, Cost Price, Unit Cost, Cost ex, Price, Unit Price, Cost inc, Selling Price, Retail Price. Column headers are case-insensitive and leading/trailing spaces are ignored.');
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
                ...['Cost', 'Cost Price', 'Unit Cost', 'Cost ex', 'Price', 'Unit Price', 'Cost inc', 'Selling Price', 'Retail Price'],
                ...['Barcode', 'Alias', 'EAN', 'UPC', 'GTIN', 'Product Barcode', 'Barcode Number']
            ].filter((header) => header !== null && header !== undefined).map(header => header.toLowerCase());
            const allowedColumns = new Set(allowedHeaders);
            const unexpectedColumns = headers.filter((header, index) => {
                if (!header)
                    return false;
                return !allowedColumns.has(header.toString().toLowerCase());
            });
            if (unexpectedColumns.length > 0) {
                errors.push(`Unexpected columns found - ${unexpectedColumns.join(', ')}`);
                return { imported, updated, errors };
            }
            // Pre-load all existing products for faster lookup (avoid repeated DB queries)
            const allProducts = await this.getAllProducts();
            const productMap = new Map();
            const barcodeMap = new Map();
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
                const row = jsonData[i]; // Type assertion for XLSX row
                const recordCount = i; // Row number for error reporting
                try {
                    // Get values from the appropriate columns
                    const sku = skuColIndex !== null && skuColIndex < row.length && row[skuColIndex] !== undefined
                        ? row[skuColIndex]?.toString()?.trim() : null;
                    const name = nameColIndex !== null && nameColIndex < row.length && row[nameColIndex] !== undefined
                        ? row[nameColIndex]?.toString()?.trim() : null;
                    const costStr = costColIndex !== null && costColIndex < row.length && row[costColIndex] !== undefined
                        ? row[costColIndex]?.toString()?.trim() : null;
                    const barcode = barcodeColIndex !== null && barcodeColIndex < row.length && row[barcodeColIndex] !== undefined
                        ? row[barcodeColIndex]?.toString()?.trim() : null;
                    // Check if all required fields are present
                    if (!sku) {
                        errors.push(`Row ${recordCount}: Missing required field - SKU. Please ensure the column exists and contains a value.`);
                    }
                    if (!name) {
                        errors.push(`Row ${recordCount}: Missing required field - Name. Please ensure the column exists and contains a value.`);
                    }
                    if (!costStr) {
                        errors.push(`Row ${recordCount}: Missing required field - Cost. Please ensure the column exists and contains a numeric value (e.g., '12.99', '$12.99', or 'EUR 12.99').`);
                    }
                    if (!barcode) {
                        errors.push(`Row ${recordCount}: Missing required field - Barcode. Please ensure the column exists and contains a value.`);
                    }
                    // If any required field is missing, skip processing this row
                    if (!sku || !name || !costStr || !barcode) {
                        continue;
                    }
                    // Validate data type for cost (should be a valid number)
                    // Handle cost values with currency symbols using the helper function
                    const cost = extractCostValueEnhanced(costStr);
                    if (cost === null) {
                        errors.push(`Row ${recordCount}: Invalid cost value - \\\"${costStr}\\\". Cost can be a positive or negative number. Acceptable formats include: '12.99', '$12.99', '€15.50', '(10.99)' for negative values, '1,234.56', '1.234,56' (European format).`);
                        continue;
                    }
                    // Additional validations
                    if (sku.length > 100) {
                        errors.push(`Row ${recordCount}: SKU too long (max 100 characters) - \\\"${sku.substring(0, 50)}...\\\". Please ensure the SKU value is 100 characters or fewer.`);
                        continue;
                    }
                    if (name.length > 200) {
                        errors.push(`Row ${recordCount}: Name too long (max 200 characters) - \\\"${name.substring(0, 50)}...\\\". Please ensure the Name value is 200 characters or fewer.`);
                        continue;
                    }
                    if (barcode.length > 100) {
                        errors.push(`Row ${recordCount}: Barcode too long (max 100 characters) - \\\"${barcode.substring(0, 50)}...\\\". Please ensure the Barcode value is 100 characters or fewer.`);
                        continue;
                    }
                    // Check if a product with this SKU or Barcode already exists using in-memory lookup
                    let existingProduct = null;
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
                        throw new Error(`Duplicate identifiers detected: SKU ${sku} exists in product ${skuProduct.id} and barcode ${barcode} exists in product ${barcodeProduct.id}. This will cause data integrity issues.`);
                    }
                    if (existingProduct) {
                        // Update existing product
                        try {
                            const updatedProduct = await this.updateProduct(existingProduct.id, {
                                barcode,
                                sku, // Update SKU as well in case it changed
                                name,
                                costPrice: cost
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
                                }
                                else {
                                    // Update with new record otherwise
                                    barcodeMap.set(barcode, updatedProduct);
                                }
                            }
                            else {
                                errors.push(`Row ${recordCount}: Failed to update existing product (SKU: ${sku})`);
                            }
                        }
                        catch (updateError) {
                            errors.push(`Row ${recordCount}: Failed to update existing product (SKU: ${sku}) - ${updateError.message}`);
                        }
                    }
                    else {
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
                            }
                            else {
                                errors.push(`Row ${recordCount}: Failed to create new product (SKU: ${sku})`);
                            }
                        }
                        catch (createError) {
                            errors.push(`Row ${recordCount}: Failed to create new product (SKU: ${sku}) - ${createError.message}`);
                        }
                    }
                }
                catch (error) {
                    errors.push(`Row ${recordCount}: ${error.message}`);
                }
            }
        }
        catch (error) {
            errors.push(`Error processing XLSX file: ${error.message}`);
        }
        console.log(`XLSX processing complete: ${imported} imported, ${updated} updated, ${errors.length} errors`);
        return { imported, updated, errors };
    }
    // Helper method to find column index by alternatives
    findColumnIndexByAlternatives(headers, alternatives) {
        for (let i = 0; i < headers.length; i++) {
            const header = headers[i];
            if (!header)
                continue;
            const cleanHeader = header.toString().trim().toLowerCase();
            for (const alt of alternatives) {
                if (cleanHeader === alt.toLowerCase()) {
                    return i;
                }
            }
        }
        return null;
    }
    async validateCSVStructure(filePath) {
        const errors = [];
        let isValid = true;
        return new Promise((resolve) => {
            // Create a parser that only reads the first few rows to check structure
            const parser = fs_1.default.createReadStream(filePath)
                .pipe((0, csv_parse_1.parse)({
                columns: true,
                skip_empty_lines: true,
                from_line: 1, // Start from the first line (header)
                to_line: 5, // Only check the first 5 lines (header + 4 data rows)
                // Disable casting to avoid type conversion errors during validation
                cast: (value, context) => {
                    // Don't cast any values to avoid automatic type conversion
                    // This ensures barcodes in scientific notation stay as strings
                    return value;
                },
            }))
                .on('error', (error) => {
                errors.push(`CSV structure validation error: ${error.message}`);
                isValid = false;
                resolve({ isValid, errors });
            })
                .on('data', (row, idx) => {
                // Check headers on the first row (idx is the row index, starting from 0)
                if (typeof idx === 'number' && idx === 0) {
                    // Find the required columns using alternative names
                    const skuHeader = this.findColumnByAlternatives(row, ['SKU', 'Item Code', 'Reorder Number', 'Product Code', 'Item Number']);
                    const nameHeader = this.findColumnByAlternatives(row, ['Name', 'Item Description', 'Product Name', 'Description', 'Item Name']);
                    const costHeader = this.findColumnByAlternatives(row, ['Cost', 'Cost Price', 'Unit Cost', 'Cost ex', 'Price', 'Unit Price', 'Cost inc', 'Selling Price', 'Retail Price']);
                    const barcodeHeader = this.findColumnByAlternatives(row, ['Barcode', 'Alias', 'EAN', 'UPC', 'GTIN', 'Product Barcode', 'Barcode Number']);
                    // Check if all required columns are present
                    if (!skuHeader) {
                        errors.push(`Missing required column header for SKU. Acceptable alternatives: SKU, Item Code, Reorder Number, Product Code, Item Number. Column headers are case-insensitive and leading/trailing spaces are ignored.`);
                        isValid = false;
                    }
                    if (!nameHeader) {
                        errors.push(`Missing required column header for Name. Acceptable alternatives: Name, Item Description, Product Name, Description, Item Name. Column headers are case-insensitive and leading/trailing spaces are ignored.`);
                        isValid = false;
                    }
                    if (!costHeader) {
                        errors.push(`Missing required column header for Cost. Acceptable alternatives: Cost, Cost Price, Unit Cost, Cost ex, Price, Unit Price, Cost inc, Selling Price, Retail Price. Column headers are case-insensitive and leading/trailing spaces are ignored.`);
                        isValid = false;
                    }
                    if (!barcodeHeader) {
                        errors.push(`Missing required column header for Barcode. Acceptable alternatives: Barcode, Alias, EAN, UPC, GTIN, Product Barcode, Barcode Number. Column headers are case-insensitive and leading/trailing spaces are ignored.`);
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
    findColumnByAlternatives(row, alternatives) {
        const headers = Object.keys(row);
        for (const alt of alternatives) {
            // Case insensitive search
            const foundHeader = headers.find(header => header.toLowerCase() === alt.toLowerCase());
            if (foundHeader) {
                return foundHeader;
            }
        }
        return null;
    }
    async getProductBySkuOrBarcode(sku, barcode) {
        const db = await (0, database_1.getDb)();
        // Check for products by SKU and barcode independently
        const bySku = await db.get("SELECT * FROM products WHERE sku = ?", sku);
        const byBarcode = await db.get("SELECT * FROM products WHERE barcode = ?", barcode);
        // If both match different products, this is an error case
        if (bySku && byBarcode && bySku.id !== byBarcode.id) {
            throw new Error(`Duplicate identifiers detected: SKU ${sku} exists in product ${bySku.id} and barcode ${barcode} exists in product ${byBarcode.id}. This will cause data integrity issues.`);
        }
        // Return the product found by either SKU or barcode (or null if neither)
        return bySku || byBarcode || null;
    }
}
exports.ProductService = ProductService;
