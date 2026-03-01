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
const product_service_1 = require("../../services/product.service");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const XLSX = __importStar(require("xlsx"));
// Mock Prisma manually
const mockPrisma = {
    product: {
        findUnique: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        upsert: jest.fn(),
    },
    organizationUsage: {
        findUnique: jest
            .fn()
            .mockResolvedValue({ organizationId: 'default-org', totalSkus: 0, maxSkus: 1000 }),
        update: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrisma)),
}; // Cast to PrismaClient to satisfy type checker
// Mock the module
jest.mock('@prisma/client', () => ({
    PrismaClient: jest.fn(() => mockPrisma),
}));
describe('XLSX Upload Functionality Tests', () => {
    let productService;
    let testXLSXPath;
    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();
        // Reset organizationUsage mock (cleared by clearAllMocks)
        mockPrisma.organizationUsage.findUnique.mockResolvedValue({
            organizationId: 'default-org',
            totalSkus: 0,
            maxSkus: 1000,
        });
        // Initialize service with mocked Prisma
        productService = new product_service_1.ProductService(mockPrisma);
        const buildMockProduct = (args) => {
            const now = new Date();
            return {
                id: Math.ceil(Math.random() * 1000),
                notes: '',
                createdAt: now,
                updatedAt: now,
                ...args.data,
            };
        };
        // Default implementations
        mockPrisma.product.findUnique.mockResolvedValue(null);
        mockPrisma.product.findMany.mockResolvedValue([]);
        mockPrisma.product.create.mockImplementation((args) => Promise.resolve(buildMockProduct(args)));
        mockPrisma.product.upsert.mockImplementation((args) => Promise.resolve(buildMockProduct({ data: args.create })));
        // Create a temporary XLSX file for testing
        const jsonData = [
            ['SKU', 'Name', 'Cost', 'Barcode'],
            ['TEST001', 'Product 1', '$12.99', '1234567890123'],
            ['TEST002', 'Product 2', '€15.50', '1234567890124'],
            ['TEST003', 'Product 3', '100.99', '1234567890125'],
        ];
        const worksheet = XLSX.utils.aoa_to_sheet(jsonData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');
        testXLSXPath = path_1.default.join(__dirname, 'test.xlsx');
        XLSX.writeFile(workbook, testXLSXPath);
    });
    afterEach(() => {
        if (fs_1.default.existsSync(testXLSXPath)) {
            fs_1.default.unlinkSync(testXLSXPath);
        }
        const otherFiles = [
            'test_alt_headers.xlsx',
            'test_missing_fields.xlsx',
            'test_invalid_cost.xlsx',
            'test_missing_headers.xlsx',
            'test_unexpected_columns.xlsx',
            'test_validation.xlsx',
        ];
        otherFiles.forEach((file) => {
            const p = path_1.default.join(__dirname, file);
            if (fs_1.default.existsSync(p))
                fs_1.default.unlinkSync(p);
        });
    });
    it('should process XLSX with basic format correctly', async () => {
        const result = await productService.processCSVUpload(testXLSXPath);
        if (result.errors.length > 0) {
            console.log('XLSX Upload Errors:', JSON.stringify(result.errors, null, 2));
        }
        expect(result.errors.length).toBe(0);
        expect(result.imported).toBe(3);
        expect(result.updated).toBe(0);
        expect(mockPrisma.product.create).toHaveBeenCalledTimes(3);
    });
    it('should process XLSX with alternative header names', async () => {
        const jsonData = [
            ['Item Code', 'Product Name', 'Unit Price', 'GTIN'],
            ['TEST001', 'Product 1', '$12.99', '1234567890123'],
            ['TEST002', 'Product 2', '€15.50', '1234567890124'],
        ];
        const worksheet = XLSX.utils.aoa_to_sheet(jsonData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');
        const testAltXLSXPath = path_1.default.join(__dirname, 'test_alt_headers.xlsx');
        XLSX.writeFile(workbook, testAltXLSXPath);
        const result = await productService.processCSVUpload(testAltXLSXPath);
        expect(result.errors.length).toBe(0);
        expect(result.imported).toBe(2);
        expect(result.updated).toBe(0);
    });
    it('should return errors for missing required fields in XLSX', async () => {
        const jsonData = [
            ['SKU', 'Name', 'Cost'],
            ['TEST001', 'Product 1', '12.99'],
        ];
        const worksheet = XLSX.utils.aoa_to_sheet(jsonData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');
        const testMissingFieldsPath = path_1.default.join(__dirname, 'test_missing_fields.xlsx');
        XLSX.writeFile(workbook, testMissingFieldsPath);
        const result = await productService.processCSVUpload(testMissingFieldsPath);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain('Missing required field - Barcode');
        expect(result.imported).toBe(0);
        expect(result.updated).toBe(0);
    });
    it('should return errors for invalid cost values in XLSX', async () => {
        const jsonData = [
            ['SKU', 'Name', 'Cost', 'Barcode'],
            ['TEST001', 'Product 1', 'invalid_cost', '1234567890123'],
        ];
        const worksheet = XLSX.utils.aoa_to_sheet(jsonData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');
        const testInvalidCostPath = path_1.default.join(__dirname, 'test_invalid_cost.xlsx');
        XLSX.writeFile(workbook, testInvalidCostPath);
        const result = await productService.processCSVUpload(testInvalidCostPath);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain('Invalid cost value');
        expect(result.imported).toBe(0);
        expect(result.updated).toBe(0);
    });
    it('should return errors when required headers are missing in XLSX', async () => {
        const jsonData = [
            ['WrongHeader1', 'WrongHeader2', 'WrongHeader3', 'WrongHeader4'],
            ['TEST001', 'Product 1', '12.99', '1234567890123'],
        ];
        const worksheet = XLSX.utils.aoa_to_sheet(jsonData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');
        const testMissingHeadersPath = path_1.default.join(__dirname, 'test_missing_headers.xlsx');
        XLSX.writeFile(workbook, testMissingHeadersPath);
        const result = await productService.processCSVUpload(testMissingHeadersPath);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain('Missing required column');
        expect(result.imported).toBe(0);
        expect(result.updated).toBe(0);
    });
    it('should return errors for unexpected columns in XLSX', async () => {
        const jsonData = [
            ['SKU', 'Name', 'Cost', 'Barcode', 'UnexpectedColumn'],
            ['TEST001', 'Product 1', '12.99', '1234567890123', 'UnexpectedValue'],
        ];
        const worksheet = XLSX.utils.aoa_to_sheet(jsonData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');
        const testUnexpectedPath = path_1.default.join(__dirname, 'test_unexpected_columns.xlsx');
        XLSX.writeFile(workbook, testUnexpectedPath);
        const result = await productService.processCSVUpload(testUnexpectedPath);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain('Unexpected columns found');
        expect(result.imported).toBe(0);
        expect(result.updated).toBe(0);
    });
    describe('XLSX Processing Validation', () => {
        let testXLSXPath;
        beforeEach(() => {
            // Reset organizationUsage mock for this nested describe
            mockPrisma.organizationUsage.findUnique.mockResolvedValue({
                organizationId: 'default-org',
                totalSkus: 0,
                maxSkus: 1000,
            });
            mockPrisma.product.findMany.mockResolvedValue([
                {
                    id: 1,
                    sku: 'TEST001',
                    name: 'Old Name',
                    costPrice: 10.0,
                    barcode: '1234567890123',
                    organizationId: 'default-org',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    expiryDate: null,
                    category: null,
                    lowStockThreshold: 5,
                    image: null,
                    isDeleted: false,
                    deletedAt: null,
                },
            ]);
            mockPrisma.product.update.mockResolvedValue({
                id: 1,
                sku: 'TEST001',
                name: 'Product 1',
                costPrice: 12.99,
                barcode: '1234567890123',
                createdAt: new Date(),
                updatedAt: new Date(),
                expiryDate: null,
                category: null,
                lowStockThreshold: 5,
                image: null,
                isDeleted: false,
                deletedAt: null,
            });
            const jsonData = [
                ['SKU', 'Name', 'Cost', 'Barcode'],
                ['TEST001', 'Product 1', '$12.99', '1234567890123'],
                ['TEST002', 'Product 2', '€15.50', '1234567890124'],
            ];
            const worksheet = XLSX.utils.aoa_to_sheet(jsonData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');
            testXLSXPath = path_1.default.join(__dirname, 'test_validation.xlsx');
            XLSX.writeFile(workbook, testXLSXPath);
        });
        afterEach(() => {
            if (fs_1.default.existsSync(testXLSXPath)) {
                fs_1.default.unlinkSync(testXLSXPath);
            }
        });
        it('should update existing products in XLSX processing', async () => {
            const result = await productService.processCSVUpload(testXLSXPath);
            expect(result.errors.length).toBe(0);
            expect(result.imported).toBe(1);
            expect(result.updated).toBe(1);
        });
    });
});
