"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable @typescript-eslint/no-explicit-any */
const product_service_1 = require("../../services/product.service");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
describe('CSV Upload Functionality Tests', () => {
    let productService;
    let mockPrisma;
    beforeEach(() => {
        mockPrisma = {
            product: {
                findUnique: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
            },
            $transaction: jest.fn((callback) => callback(mockPrisma)),
        };
        productService = new product_service_1.ProductService(mockPrisma);
    });
    it('should process CSV with basic format correctly', async () => {
        mockPrisma.product.findUnique.mockResolvedValue(null); // No existing products
        // Simplify mock to return a valid object always
        mockPrisma.product.create.mockImplementation((args) => Promise.resolve({
            id: 1,
            name: 'Test Product',
            sku: 'TEST001',
            costPrice: 10.0,
            barcode: '123456789',
            ...args.data,
            createdAt: new Date(),
            updatedAt: new Date(),
        }));
        const csvContent = `SKU,Name,Cost,Barcode
TEST001,Product 1,$12.99,1234567890123
TEST002,Product 2,€15.50,1234567890124
TEST003,Product 3,"1,000.99",1234567890125`;
        const testCSVPath = path_1.default.join(__dirname, 'test.csv');
        fs_1.default.writeFileSync(testCSVPath, csvContent);
        try {
            const result = await productService.processCSVUploadInternal(testCSVPath);
            expect(result.errors.length).toBe(0);
            expect(result.imported).toBe(3); // All 3 rows should be imported
            expect(result.updated).toBe(0); // No updates since it's first import
        }
        finally {
            if (fs_1.default.existsSync(testCSVPath)) {
                fs_1.default.unlinkSync(testCSVPath);
            }
        }
    });
});
// Test cases for alternative header name recognition
describe('CSV Header Name Recognition', () => {
    let productService;
    let mockPrisma;
    beforeEach(() => {
        mockPrisma = { product: {} };
        productService = new product_service_1.ProductService(mockPrisma);
    });
    it('should recognize alternative SKU column names', () => {
        const row = { 'Item Code': 'SKU123', Name: 'Product', Cost: '10.00', Barcode: '123456' };
        const alternatives = ['SKU', 'Item Code', 'Reorder Number', 'Product Code', 'Item Number'];
        // Access the private method by casting to 'any'
        const header = productService.findColumnByAlternatives(row, alternatives);
        expect(header).toBe('Item Code');
    });
    it('should recognize alternative Name column names', () => {
        const row = { SKU: 'SKU123', 'Product Name': 'Product', Cost: '10.00', Barcode: '123456' };
        const alternatives = ['Name', 'Item Description', 'Product Name', 'Description', 'Item Name'];
        const header = productService.findColumnByAlternatives(row, alternatives);
        expect(header).toBe('Product Name');
    });
    it('should recognize alternative Cost column names', () => {
        const row = { SKU: 'SKU123', Name: 'Product', 'Unit Price': '10.00', Barcode: '123456' };
        const alternatives = [
            'Cost',
            'Cost Price',
            'Unit Cost',
            'Cost ex',
            'Price',
            'Unit Price',
            'Cost inc',
            'Selling Price',
            'Retail Price',
        ];
        const header = productService.findColumnByAlternatives(row, alternatives);
        expect(header).toBe('Unit Price');
    });
    it('should recognize alternative Barcode column names', () => {
        const row = { SKU: 'SKU123', Name: 'Product', Cost: '10.00', GTIN: '123456' };
        const alternatives = [
            'Barcode',
            'Alias',
            'EAN',
            'UPC',
            'GTIN',
            'Product Barcode',
            'Barcode Number',
        ];
        const header = productService.findColumnByAlternatives(row, alternatives);
        expect(header).toBe('GTIN');
    });
    it('should be case-insensitive for headers', () => {
        const row = { sku: 'SKU123', name: 'Product', cost: '10.00', barcode: '123456' };
        const skuHeader = productService.findColumnByAlternatives(row, ['SKU']);
        const nameHeader = productService.findColumnByAlternatives(row, ['Name']);
        const costHeader = productService.findColumnByAlternatives(row, ['Cost']);
        const barcodeHeader = productService.findColumnByAlternatives(row, ['Barcode']);
        expect(skuHeader).toBe('sku');
        expect(nameHeader).toBe('name');
        expect(costHeader).toBe('cost');
        expect(barcodeHeader).toBe('barcode');
    });
});
// Test cases for currency representation
describe('Currency Representation Handling', () => {
    it('should correctly parse basic numeric values', () => {
        expect(product_service_1.ProductService['extractCostValueEnhanced']('12.34')).toBe(12.34);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('100')).toBe(100);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('0.99')).toBe(0.99);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('1000.00')).toBe(1000.0);
    });
    it('should handle currency symbols at the beginning', () => {
        expect(product_service_1.ProductService['extractCostValueEnhanced']('$12.34')).toBe(12.34);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('€12.34')).toBe(12.34);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('£12.34')).toBe(12.34);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('¥1234')).toBe(1234);
    });
    it('should handle currency symbols at the end', () => {
        expect(product_service_1.ProductService['extractCostValueEnhanced']('12.34$')).toBe(12.34);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('12.34€')).toBe(12.34);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('1234¥')).toBe(1234);
    });
    it('should handle currency abbreviations', () => {
        expect(product_service_1.ProductService['extractCostValueEnhanced']('USD 12.34')).toBe(12.34);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('EUR 12.34')).toBe(12.34);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('GBP 12.34')).toBe(12.34);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('AUD 12.34')).toBe(12.34);
    });
    it('should handle complex currency representations', () => {
        expect(product_service_1.ProductService['extractCostValueEnhanced']('AUD$ 1,234.56')).toBe(1234.56);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('CAD $1,234.56')).toBe(1234.56);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('€ 1.234,56')).toBe(1234.56); // European format
        expect(product_service_1.ProductService['extractCostValueEnhanced']('GBP 1,234.56')).toBe(1234.56);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('¥1,234')).toBe(1234);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('RMB 1,234.56')).toBe(1234.56);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('Rp 1.234,56')).toBe(1234.56);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('$ 1,234.56')).toBe(1234.56);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('  € 1.234,56  ')).toBe(1234.56); // With spaces
    });
    it('should return null for invalid inputs', () => {
        expect(product_service_1.ProductService['extractCostValueEnhanced']('')).toBeNull();
        expect(product_service_1.ProductService['extractCostValueEnhanced']('not a number')).toBeNull();
        expect(product_service_1.ProductService['extractCostValueEnhanced']('abc')).toBeNull();
        expect(product_service_1.ProductService['extractCostValueEnhanced']('@#$%')).toBeNull();
    });
});
// Test cases for flexible data validation with different number formats
describe('Flexible Data Validation for Different Number Formats', () => {
    it('should handle US number format (comma as thousands separator, dot as decimal)', () => {
        expect(product_service_1.ProductService['extractCostValueEnhanced']('1,234.56')).toBe(1234.56);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('12,345.67')).toBe(12345.67);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('1,000,000.99')).toBe(1000000.99);
    });
    it('should handle European number format (dot as thousands separator, comma as decimal)', () => {
        expect(product_service_1.ProductService['extractCostValueEnhanced']('1.234,56')).toBe(1234.56);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('12.345,67')).toBe(12345.67);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('1.000.000,99')).toBe(1000000.99);
    });
    it('should handle mixed formats correctly', () => {
        // When both commas and dots exist, check which one is at the end
        expect(product_service_1.ProductService['extractCostValueEnhanced']('1.234,56')).toBe(1234.56); // European
        expect(product_service_1.ProductService['extractCostValueEnhanced']('1,234.56')).toBe(1234.56); // US
    });
    it('should handle numbers with thousands separators only', () => {
        expect(product_service_1.ProductService['extractCostValueEnhanced']('1,000')).toBe(1000);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('1.000')).toBe(1000);
        // These work now because we fixed the logic
        expect(product_service_1.ProductService['extractCostValueEnhanced']('1,000,000')).toBe(1000000);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('1.000.000')).toBe(1000000);
    });
    it('should handle decimal numbers without thousands separators', () => {
        expect(product_service_1.ProductService['extractCostValueEnhanced']('12.34')).toBe(12.34);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('12,34')).toBe(12.34);
    });
    it('should handle various edge cases', () => {
        // Multiple decimals - likely thousands separators
        expect(product_service_1.ProductService['extractCostValueEnhanced']('12.34.56')).toBe(1234.56);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('1.234.567')).toBe(1234567);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('12,34,56')).toBe(123456);
        // Mixed with currency symbols
        expect(product_service_1.ProductService['extractCostValueEnhanced']('$1,234.56')).toBe(1234.56);
        expect(product_service_1.ProductService['extractCostValueEnhanced']('€1.234,56')).toBe(1234.56);
    });
});
// Test cases for error handling scenarios
describe('CSV Upload Error Handling', () => {
    let productService;
    let mockPrisma;
    beforeEach(() => {
        mockPrisma = {
            product: {
                findUnique: jest.fn(),
                create: jest.fn(),
            },
            $transaction: jest.fn((callback) => callback(mockPrisma)),
        };
        productService = new product_service_1.ProductService(mockPrisma);
    });
    it('should return errors for missing required fields', async () => {
        // Missing Barcode
        mockPrisma.product.findUnique.mockResolvedValue(null);
        // Create a CSV with missing required fields
        const csvContent = `SKU,Name,Cost\nTEST001,Product 1,12.99`;
        const testCSVPath = path_1.default.join(__dirname, 'test_missing_fields.csv');
        fs_1.default.writeFileSync(testCSVPath, csvContent);
        try {
            const result = await productService.processCSVUploadInternal(testCSVPath);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]).toContain('Missing required field - Barcode');
            expect(result.imported).toBe(0);
            expect(result.updated).toBe(0);
        }
        finally {
            if (fs_1.default.existsSync(testCSVPath))
                fs_1.default.unlinkSync(testCSVPath);
        }
    });
    it('should return errors for invalid cost values', async () => {
        mockPrisma.product.findUnique.mockResolvedValue(null);
        const csvContent = `SKU,Name,Cost,Barcode\nTEST001,Product 1,invalid_cost,1234567890123`;
        const testCSVPath = path_1.default.join(__dirname, 'test_invalid_cost.csv');
        fs_1.default.writeFileSync(testCSVPath, csvContent);
        try {
            const result = await productService.processCSVUploadInternal(testCSVPath);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]).toContain('Invalid cost value');
            expect(result.imported).toBe(0);
            expect(result.updated).toBe(0);
        }
        finally {
            if (fs_1.default.existsSync(testCSVPath))
                fs_1.default.unlinkSync(testCSVPath);
        }
    });
    it('should return errors for values that exceed length limits', async () => {
        mockPrisma.product.findUnique.mockResolvedValue(null);
        // Mock create to prevent crash if validation fails (it shouldn't execute, but safety)
        mockPrisma.product.create.mockResolvedValue({
            id: 1,
            name: 'Too Long',
            sku: 'TEST001',
            barcode: '123',
        });
        const longName = 'product'.repeat(40); // 7 * 40 = 280 characters
        const csvContent = `SKU,Name,Cost,Barcode\nTEST001,${longName},12.99,1234567890123`;
        const testCSVPath = path_1.default.join(__dirname, 'test_length_error.csv');
        fs_1.default.writeFileSync(testCSVPath, csvContent);
        try {
            const result = await productService.processCSVUploadInternal(testCSVPath);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]).toContain('Name too long');
            expect(result.imported).toBe(0);
            expect(result.updated).toBe(0);
        }
        finally {
            if (fs_1.default.existsSync(testCSVPath))
                fs_1.default.unlinkSync(testCSVPath);
        }
    });
    it('should return errors when required headers are missing', async () => {
        // This fails at header validation stage, so DB logic is not reached, but mock needed for constructor
        const csvContent = `WrongHeader1,WrongHeader2,WrongHeader3,WrongHeader4\nTEST001,Product 1,12.99,1234567890123`;
        const testCSVPath = path_1.default.join(__dirname, 'test_missing_headers.csv');
        fs_1.default.writeFileSync(testCSVPath, csvContent);
        try {
            const result = await productService.processCSVUploadInternal(testCSVPath);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]).toContain('Missing required field - SKU');
            expect(result.imported).toBe(0);
            expect(result.updated).toBe(0);
        }
        finally {
            if (fs_1.default.existsSync(testCSVPath))
                fs_1.default.unlinkSync(testCSVPath);
        }
    });
});
describe('Comprehensive CSV Processing Tests', () => {
    let productService;
    let mockPrisma;
    beforeEach(() => {
        mockPrisma = {
            product: {
                findUnique: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
            },
            $transaction: jest.fn((callback) => callback(mockPrisma)),
        };
        productService = new product_service_1.ProductService(mockPrisma);
    });
    it('should process CSV with various currency formats', async () => {
        mockPrisma.product.findUnique.mockResolvedValue(null);
        mockPrisma.product.create.mockImplementation((args) => Promise.resolve({
            id: 1,
            ...args.data,
            createdAt: new Date(),
            updatedAt: new Date(),
        }));
        const csvContent = `SKU,Name,Cost,Barcode
TEST001,Product 1,$12.99,1234567890123
TEST002,Product 2,€15.50,1234567890124
TEST003,Product 3,GBP 20.75,1234567890125
TEST004,Product 4,¥1000,1234567890126
TEST005,Product 5,AUD$ 35.99,1234567890127`;
        const testCSVPath = path_1.default.join(__dirname, 'test_currency_formats.csv');
        fs_1.default.writeFileSync(testCSVPath, csvContent);
        try {
            const result = await productService.processCSVUploadInternal(testCSVPath);
            expect(result.errors.length).toBe(0);
            expect(result.imported).toBe(5);
            expect(result.updated).toBe(0);
        }
        finally {
            if (fs_1.default.existsSync(testCSVPath))
                fs_1.default.unlinkSync(testCSVPath);
        }
    });
    it('should process CSV with alternative header names', async () => {
        mockPrisma.product.findUnique.mockResolvedValue(null);
        mockPrisma.product.create.mockImplementation((args) => Promise.resolve({
            id: 1,
            ...args.data,
            createdAt: new Date(),
            updatedAt: new Date(),
        }));
        const csvContent = `Item Code,Product Name,Unit Price,GTIN
TEST001,Product 1,12.99,1234567890123
TEST002,Product 2,15.50,1234567890124
TEST003,Product 3,20.75,1234567890125`;
        const testCSVPath = path_1.default.join(__dirname, 'test_alt_headers.csv');
        fs_1.default.writeFileSync(testCSVPath, csvContent);
        try {
            const result = await productService.processCSVUploadInternal(testCSVPath);
            expect(result.errors.length).toBe(0);
            expect(result.imported).toBe(3);
            expect(result.updated).toBe(0);
        }
        finally {
            if (fs_1.default.existsSync(testCSVPath))
                fs_1.default.unlinkSync(testCSVPath);
        }
    });
});
