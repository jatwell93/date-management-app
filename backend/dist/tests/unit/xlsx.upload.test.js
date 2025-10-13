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
const database_1 = require("../../database");
// Mock the database functions to avoid actual database operations during tests
jest.mock("../../database", () => ({
    getDb: jest.fn(),
    releaseDb: jest.fn(),
}));
describe("XLSX Upload Functionality Tests", () => {
    let productService;
    let testXLSXPath;
    const mockStatement = {
        run: jest.fn(),
        all: jest.fn(),
        get: jest.fn(),
    };
    const mockDb = {
        prepare: jest.fn(() => mockStatement),
    };
    beforeEach(() => {
        productService = new product_service_1.ProductService();
        database_1.getDb.mockReturnValue(mockDb);
        jest.spyOn(productService, 'getAllProducts').mockResolvedValue([]);
        // Create a temporary XLSX file for testing
        const jsonData = [
            ["SKU", "Name", "Cost", "Barcode"],
            ["TEST001", "Product 1", "$12.99", "1234567890123"],
            ["TEST002", "Product 2", "€15.50", "1234567890124"],
            ["TEST003", "Product 3", "100.99", "1234567890125"]
        ];
        const worksheet = XLSX.utils.aoa_to_sheet(jsonData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Products");
        testXLSXPath = path_1.default.join(__dirname, "test.xlsx");
        XLSX.writeFile(workbook, testXLSXPath);
    });
    afterEach(() => {
        // Clean up the test file
        if (fs_1.default.existsSync(testXLSXPath)) {
            fs_1.default.unlinkSync(testXLSXPath);
        }
        jest.clearAllMocks();
    });
    it("should process XLSX with basic format correctly", async () => {
        mockStatement.get.mockReturnValue(undefined);
        mockStatement.run.mockReturnValue({ lastInsertRowid: 1 });
        const result = await productService.processCSVUpload(testXLSXPath);
        expect(result.errors.length).toBe(0);
        expect(result.imported).toBe(3); // All 3 rows should be imported
        expect(result.updated).toBe(0); // No updates since it's first import
    });
    it("should process XLSX with alternative header names", async () => {
        // Create an XLSX with alternative header names
        const jsonData = [
            ["Item Code", "Product Name", "Unit Price", "GTIN"],
            ["TEST001", "Product 1", "$12.99", "1234567890123"],
            ["TEST002", "Product 2", "€15.50", "1234567890124"]
        ];
        const worksheet = XLSX.utils.aoa_to_sheet(jsonData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Products");
        const testAltXLSXPath = path_1.default.join(__dirname, "test_alt_headers.xlsx");
        XLSX.writeFile(workbook, testAltXLSXPath);
        try {
            mockStatement.get.mockReturnValue(undefined);
            mockStatement.run.mockReturnValue({ lastInsertRowid: 1 });
            const result = await productService.processCSVUpload(testAltXLSXPath);
            expect(result.errors.length).toBe(0);
            expect(result.imported).toBe(2); // Both rows should be imported
            expect(result.updated).toBe(0); // No updates since it's first import
        }
        finally {
            if (fs_1.default.existsSync(testAltXLSXPath)) {
                fs_1.default.unlinkSync(testAltXLSXPath);
            }
        }
    });
    it("should return errors for missing required fields in XLSX", async () => {
        // Create an XLSX with missing required fields
        const jsonData = [
            ["SKU", "Name", "Cost"],
            ["TEST001", "Product 1", "12.99"]
        ];
        const worksheet = XLSX.utils.aoa_to_sheet(jsonData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Products");
        const testMissingFieldsPath = path_1.default.join(__dirname, "test_missing_fields.xlsx");
        XLSX.writeFile(workbook, testMissingFieldsPath);
        try {
            const result = await productService.processCSVUpload(testMissingFieldsPath);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]).toContain("Row 1: Missing required field - Barcode");
            expect(result.imported).toBe(0);
            expect(result.updated).toBe(0);
        }
        finally {
            if (fs_1.default.existsSync(testMissingFieldsPath)) {
                fs_1.default.unlinkSync(testMissingFieldsPath);
            }
        }
    });
    it("should return errors for invalid cost values in XLSX", async () => {
        // Create an XLSX with invalid cost values
        const jsonData = [
            ["SKU", "Name", "Cost", "Barcode"],
            ["TEST001", "Product 1", "invalid_cost", "1234567890123"]
        ];
        const worksheet = XLSX.utils.aoa_to_sheet(jsonData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Products");
        const testInvalidCostPath = path_1.default.join(__dirname, "test_invalid_cost.xlsx");
        XLSX.writeFile(workbook, testInvalidCostPath);
        try {
            const result = await productService.processCSVUpload(testInvalidCostPath);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]).toContain("Invalid cost value");
            expect(result.imported).toBe(0);
            expect(result.updated).toBe(0);
        }
        finally {
            if (fs_1.default.existsSync(testInvalidCostPath)) {
                fs_1.default.unlinkSync(testInvalidCostPath);
            }
        }
    });
    it("should return errors when required headers are missing in XLSX", async () => {
        // Create an XLSX without required headers
        const jsonData = [
            ["WrongHeader1", "WrongHeader2", "WrongHeader3", "WrongHeader4"],
            ["TEST001", "Product 1", "12.99", "1234567890123"]
        ];
        const worksheet = XLSX.utils.aoa_to_sheet(jsonData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Products");
        const testMissingHeadersPath = path_1.default.join(__dirname, "test_missing_headers.xlsx");
        XLSX.writeFile(workbook, testMissingHeadersPath);
        try {
            const result = await productService.processCSVUpload(testMissingHeadersPath);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]).toContain("Missing required column");
            expect(result.imported).toBe(0);
            expect(result.updated).toBe(0);
        }
        finally {
            if (fs_1.default.existsSync(testMissingHeadersPath)) {
                fs_1.default.unlinkSync(testMissingHeadersPath);
            }
        }
    });
    it("should return errors for unexpected columns in XLSX", async () => {
        // Create an XLSX with unexpected columns
        const jsonData = [
            ["SKU", "Name", "Cost", "Barcode", "UnexpectedColumn"],
            ["TEST001", "Product 1", "12.99", "1234567890123", "UnexpectedValue"]
        ];
        const worksheet = XLSX.utils.aoa_to_sheet(jsonData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Products");
        const testUnexpectedPath = path_1.default.join(__dirname, "test_unexpected_columns.xlsx");
        XLSX.writeFile(workbook, testUnexpectedPath);
        try {
            const result = await productService.processCSVUpload(testUnexpectedPath);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]).toContain("Unexpected columns found");
            expect(result.imported).toBe(0);
            expect(result.updated).toBe(0);
        }
        finally {
            if (fs_1.default.existsSync(testUnexpectedPath)) {
                fs_1.default.unlinkSync(testUnexpectedPath);
            }
        }
    });
});
// Test the XLSX specific validation and processing
describe("XLSX Processing Validation", () => {
    let productService;
    let testXLSXPath;
    const mockStatement = {
        run: jest.fn(),
        all: jest.fn(),
        get: jest.fn(),
    };
    const mockDb = {
        prepare: jest.fn(() => mockStatement),
    };
    beforeEach(() => {
        productService = new product_service_1.ProductService();
        database_1.getDb.mockReturnValue(mockDb);
        jest.spyOn(productService, 'getAllProducts').mockResolvedValue([
            { id: 1, sku: 'TEST001', name: 'Old Name', costPrice: 10.00, barcode: '1234567890123', createdAt: 'now', updatedAt: 'now' }
        ]);
        // Create a temporary XLSX file for testing
        const jsonData = [
            ["SKU", "Name", "Cost", "Barcode"],
            ["TEST001", "Product 1", "$12.99", "1234567890123"],
            ["TEST002", "Product 2", "€15.50", "1234567890124"]
        ];
        const worksheet = XLSX.utils.aoa_to_sheet(jsonData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Products");
        testXLSXPath = path_1.default.join(__dirname, "test_validation.xlsx");
        XLSX.writeFile(workbook, testXLSXPath);
    });
    afterEach(() => {
        // Clean up the test file
        if (fs_1.default.existsSync(testXLSXPath)) {
            fs_1.default.unlinkSync(testXLSXPath);
        }
        jest.clearAllMocks();
    });
    it("should update existing products in XLSX processing", async () => {
        mockStatement.get.mockReturnValueOnce({ id: 1, sku: 'TEST001', name: 'Old Name', costPrice: 10.00, barcode: '1234567890123' });
        mockStatement.get.mockReturnValueOnce(undefined);
        mockStatement.run.mockReturnValueOnce({ changes: 1 });
        mockStatement.run.mockReturnValueOnce({ lastInsertRowid: 2 });
        const result = await productService.processCSVUpload(testXLSXPath);
        expect(result.errors.length).toBe(0);
        expect(result.imported).toBe(1);
        expect(result.updated).toBe(1);
    });
});
