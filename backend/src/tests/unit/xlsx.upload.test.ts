import { ProductService } from "../../services/product.service";
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { getDb } from "../../database";

// Mock the database functions to avoid actual database operations during tests
jest.mock("../../database", () => ({
  getDb: jest.fn(),
  releaseDb: jest.fn(),
}));

describe("XLSX Upload Functionality Tests", () => {
  let productService: ProductService;
  let testXLSXPath: string;
  const mockStatement = {
    run: jest.fn(),
    all: jest.fn(),
    get: jest.fn(),
  };
  const mockDb = {
    prepare: jest.fn(() => mockStatement),
  };

  beforeEach(() => {
    productService = new ProductService();
    (getDb as jest.Mock).mockReturnValue(mockDb);
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
    
    testXLSXPath = path.join(__dirname, "test.xlsx");
    XLSX.writeFile(workbook, testXLSXPath);
  });

  afterEach(() => {
    // Clean up the test file
    if (fs.existsSync(testXLSXPath)) {
      fs.unlinkSync(testXLSXPath);
    }
    jest.clearAllMocks();
  });

  it("should process XLSX with basic format correctly", async () => {
    mockStatement.get.mockReturnValue(undefined);
    mockStatement.run.mockReturnValue({ lastInsertRowid: 1 });
    const result = await productService.processCSVUpload(testXLSXPath);
    
    expect(result.errors.length).toBe(0);
    expect(result.imported).toBe(3); // All 3 rows should be imported
    expect(result.updated).toBe(0);  // No updates since it's first import
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
    
    const testAltXLSXPath = path.join(__dirname, "test_alt_headers.xlsx");
    XLSX.writeFile(workbook, testAltXLSXPath);
    
    try {
      mockStatement.get.mockReturnValue(undefined);
      mockStatement.run.mockReturnValue({ lastInsertRowid: 1 });
      const result = await productService.processCSVUpload(testAltXLSXPath);
      
      expect(result.errors.length).toBe(0);
      expect(result.imported).toBe(2); // Both rows should be imported
      expect(result.updated).toBe(0);  // No updates since it's first import
    } finally {
      if (fs.existsSync(testAltXLSXPath)) {
        fs.unlinkSync(testAltXLSXPath);
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
    
    const testMissingFieldsPath = path.join(__dirname, "test_missing_fields.xlsx");
    XLSX.writeFile(workbook, testMissingFieldsPath);
    
    try {
      const result = await productService.processCSVUpload(testMissingFieldsPath);
      
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("Row 1: Missing required field - Barcode");
      expect(result.imported).toBe(0);
      expect(result.updated).toBe(0);
    } finally {
      if (fs.existsSync(testMissingFieldsPath)) {
        fs.unlinkSync(testMissingFieldsPath);
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
    
    const testInvalidCostPath = path.join(__dirname, "test_invalid_cost.xlsx");
    XLSX.writeFile(workbook, testInvalidCostPath);
    
    try {
      const result = await productService.processCSVUpload(testInvalidCostPath);
      
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("Invalid cost value");
      expect(result.imported).toBe(0);
      expect(result.updated).toBe(0);
    } finally {
      if (fs.existsSync(testInvalidCostPath)) {
        fs.unlinkSync(testInvalidCostPath);
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
    
    const testMissingHeadersPath = path.join(__dirname, "test_missing_headers.xlsx");
    XLSX.writeFile(workbook, testMissingHeadersPath);
    
    try {
      const result = await productService.processCSVUpload(testMissingHeadersPath);
      
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("Missing required column");
      expect(result.imported).toBe(0);
      expect(result.updated).toBe(0);
    } finally {
      if (fs.existsSync(testMissingHeadersPath)) {
        fs.unlinkSync(testMissingHeadersPath);
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
    
    const testUnexpectedPath = path.join(__dirname, "test_unexpected_columns.xlsx");
    XLSX.writeFile(workbook, testUnexpectedPath);
    
    try {
      const result = await productService.processCSVUpload(testUnexpectedPath);
      
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("Unexpected columns found");
      expect(result.imported).toBe(0);
      expect(result.updated).toBe(0);
    } finally {
      if (fs.existsSync(testUnexpectedPath)) {
        fs.unlinkSync(testUnexpectedPath);
      }
    }
  });
});

// Test the XLSX specific validation and processing
describe("XLSX Processing Validation", () => {
  let productService: ProductService;
  let testXLSXPath: string;
  const mockStatement = {
    run: jest.fn(),
    all: jest.fn(),
    get: jest.fn(),
  };
  const mockDb = {
    prepare: jest.fn(() => mockStatement),
  };

  beforeEach(() => {
    productService = new ProductService();
    (getDb as jest.Mock).mockReturnValue(mockDb);
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
    
    testXLSXPath = path.join(__dirname, "test_validation.xlsx");
    XLSX.writeFile(workbook, testXLSXPath);
  });

  afterEach(() => {
    // Clean up the test file
    if (fs.existsSync(testXLSXPath)) {
      fs.unlinkSync(testXLSXPath);
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
