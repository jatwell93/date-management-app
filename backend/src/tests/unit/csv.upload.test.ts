import { ProductService } from "../../services/product.service";
import fs from "fs";
import path from "path";

// Mock the database functions to avoid actual database operations during tests
jest.mock("../../database", () => ({
  getDb: jest.fn(),
}));

describe("CSV Upload Functionality Tests", () => {
  let productService: ProductService;
  let testCSVPath: string;

  beforeAll(() => {
    productService = new ProductService();
    
    // Create a temporary CSV file for testing
    const csvContent = `SKU,Name,Cost,Barcode
TEST001,Product 1,$12.99,1234567890123
TEST002,Product 2,€15.50,1234567890124
TEST003,Product 3,1,000.99,1234567890125`;
    
    testCSVPath = path.join(__dirname, "test.csv");
    fs.writeFileSync(testCSVPath, csvContent);
  });

  afterAll(() => {
    // Clean up the test file
    if (fs.existsSync(testCSVPath)) {
      fs.unlinkSync(testCSVPath);
    }
  });

  it("should process CSV with basic format correctly", async () => {
    const result = await productService.processCSVUpload(testCSVPath);
    
    expect(result.errors.length).toBe(0);
    expect(result.imported).toBe(3); // All 3 rows should be imported
    expect(result.updated).toBe(0);  // No updates since it's first import
  });
});

// Test cases for alternative header name recognition
describe("CSV Header Name Recognition", () => {
  let productService: ProductService;

  beforeEach(() => {
    productService = new ProductService();
  });

  it("should recognize alternative SKU column names", () => {
    const row = { "Item Code": "SKU123", "Name": "Product", "Cost": "10.00", "Barcode": "123456" };
    const alternatives = ['SKU', 'Item Code', 'Reorder Number', 'Product Code', 'Item Number'];
    
    // Access the private method by casting to 'any'
    const header = (productService as any).findColumnByAlternatives(row, alternatives);
    expect(header).toBe("Item Code");
  });

  it("should recognize alternative Name column names", () => {
    const row = { "SKU": "SKU123", "Product Name": "Product", "Cost": "10.00", "Barcode": "123456" };
    const alternatives = ['Name', 'Item Description', 'Product Name', 'Description', 'Item Name'];
    
    const header = (productService as any).findColumnByAlternatives(row, alternatives);
    expect(header).toBe("Product Name");
  });

  it("should recognize alternative Cost column names", () => {
    const row = { "SKU": "SKU123", "Name": "Product", "Unit Price": "10.00", "Barcode": "123456" };
    const alternatives = ['Cost', 'Cost Price', 'Unit Cost', 'Cost ex', 'Price', 'Unit Price', 'Cost inc', 'Selling Price', 'Retail Price'];
    
    const header = (productService as any).findColumnByAlternatives(row, alternatives);
    expect(header).toBe("Unit Price");
  });

  it("should recognize alternative Barcode column names", () => {
    const row = { "SKU": "SKU123", "Name": "Product", "Cost": "10.00", "GTIN": "123456" };
    const alternatives = ['Barcode', 'Alias', 'EAN', 'UPC', 'GTIN', 'Product Barcode', 'Barcode Number'];
    
    const header = (productService as any).findColumnByAlternatives(row, alternatives);
    expect(header).toBe("GTIN");
  });

  it("should be case-insensitive for headers", () => {
    const row = { "sku": "SKU123", "name": "Product", "cost": "10.00", "barcode": "123456" };
    const alternatives = ['SKU', 'Name', 'Cost', 'Barcode'];
    
    const skuHeader = (productService as any).findColumnByAlternatives(row, ['SKU']);
    const nameHeader = (productService as any).findColumnByAlternatives(row, ['Name']);
    const costHeader = (productService as any).findColumnByAlternatives(row, ['Cost']);
    const barcodeHeader = (productService as any).findColumnByAlternatives(row, ['Barcode']);
    
    expect(skuHeader).toBe("sku");
    expect(nameHeader).toBe("name");
    expect(costHeader).toBe("cost");
    expect(barcodeHeader).toBe("barcode");
  });
});

// Test cases for currency representation
describe("Currency Representation Handling", () => {
  it("should correctly parse basic numeric values", () => {
    expect(ProductService["extractCostValueEnhanced"]("12.34")).toBe(12.34);
    expect(ProductService["extractCostValueEnhanced"]("100")).toBe(100);
    expect(ProductService["extractCostValueEnhanced"]("0.99")).toBe(0.99);
    expect(ProductService["extractCostValueEnhanced"]("1000.00")).toBe(1000.00);
  });

  it("should handle currency symbols at the beginning", () => {
    expect(ProductService["extractCostValueEnhanced"]("$12.34")).toBe(12.34);
    expect(ProductService["extractCostValueEnhanced"]("€12.34")).toBe(12.34);
    expect(ProductService["extractCostValueEnhanced"]("£12.34")).toBe(12.34);
    expect(ProductService["extractCostValueEnhanced"]("¥1234")).toBe(1234);
  });

  it("should handle currency symbols at the end", () => {
    expect(ProductService["extractCostValueEnhanced"]("12.34$")).toBe(12.34);
    expect(ProductService["extractCostValueEnhanced"]("12.34€")).toBe(12.34);
    expect(ProductService["extractCostValueEnhanced"]("1234¥")).toBe(1234);
  });

  it("should handle currency abbreviations", () => {
    expect(ProductService["extractCostValueEnhanced"]("USD 12.34")).toBe(12.34);
    expect(ProductService["extractCostValueEnhanced"]("EUR 12.34")).toBe(12.34);
    expect(ProductService["extractCostValueEnhanced"]("GBP 12.34")).toBe(12.34);
    expect(ProductService["extractCostValueEnhanced"]("AUD 12.34")).toBe(12.34);
  });

  it("should handle complex currency representations", () => {
    expect(ProductService["extractCostValueEnhanced"]("AUD$ 1,234.56")).toBe(1234.56);
    expect(ProductService["extractCostValueEnhanced"]("CAD $1,234.56")).toBe(1234.56);
    expect(ProductService["extractCostValueEnhanced"]("€ 1.234,56")).toBe(1234.56);  // European format
    expect(ProductService["extractCostValueEnhanced"]("GBP 1,234.56")).toBe(1234.56);
    expect(ProductService["extractCostValueEnhanced"]("¥1,234")).toBe(1234);
    expect(ProductService["extractCostValueEnhanced"]("RMB 1,234.56")).toBe(1234.56);
    expect(ProductService["extractCostValueEnhanced"]("Rp 1.234,56")).toBe(1234.56);
    expect(ProductService["extractCostValueEnhanced"]("$ 1,234.56")).toBe(1234.56);
    expect(ProductService["extractCostValueEnhanced"]("  € 1.234,56  ")).toBe(1234.56);  // With spaces
  });

  it("should return null for invalid inputs", () => {
    expect(ProductService["extractCostValueEnhanced"]("")).toBeNull();
    expect(ProductService["extractCostValueEnhanced"]("not a number")).toBeNull();
    expect(ProductService["extractCostValueEnhanced"]("abc")).toBeNull();
    expect(ProductService["extractCostValueEnhanced"]("@#$%")).toBeNull();
  });
});

// Test cases for flexible data validation with different number formats
describe("Flexible Data Validation for Different Number Formats", () => {
  it("should handle US number format (comma as thousands separator, dot as decimal)", () => {
    expect(ProductService["extractCostValueEnhanced"]("1,234.56")).toBe(1234.56);
    expect(ProductService["extractCostValueEnhanced"]("12,345.67")).toBe(12345.67);
    expect(ProductService["extractCostValueEnhanced"]("1,000,000.99")).toBe(1000000.99);
  });

  it("should handle European number format (dot as thousands separator, comma as decimal)", () => {
    expect(ProductService["extractCostValueEnhanced"]("1.234,56")).toBe(1234.56);
    expect(ProductService["extractCostValueEnhanced"]("12.345,67")).toBe(12345.67);
    expect(ProductService["extractCostValueEnhanced"]("1.000.000,99")).toBe(1000000.99);
  });

  it("should handle mixed formats correctly", () => {
    // When both commas and dots exist, check which one is at the end
    expect(ProductService["extractCostValueEnhanced"]("1.234,56")).toBe(1234.56);  // European
    expect(ProductService["extractCostValueEnhanced"]("1,234.56")).toBe(1234.56);  // US
  });

  it("should handle numbers with thousands separators only", () => {
    expect(ProductService["extractCostValueEnhanced"]("1,000")).toBe(1000);
    expect(ProductService["extractCostValueEnhanced"]("1.000")).toBe(1000);
    expect(ProductService["extractCostValueEnhanced"]("1,000,000")).toBe(1000000);
    expect(ProductService["extractCostValueEnhanced"]("1.000.000")).toBe(1000000);
  });

  it("should handle decimal numbers without thousands separators", () => {
    expect(ProductService["extractCostValueEnhanced"]("12.34")).toBe(12.34);
    expect(ProductService["extractCostValueEnhanced"]("12,34")).toBe(12.34);
  });

  it("should handle various edge cases", () => {
    // Multiple decimals - likely thousands separators
    expect(ProductService["extractCostValueEnhanced"]("12.34.56")).toBe(1234.56);
    expect(ProductService["extractCostValueEnhanced"]("1.234.567")).toBe(1234567);
    expect(ProductService["extractCostValueEnhanced"]("12,34,56")).toBe(123456);
    
    // Mixed with currency symbols
    expect(ProductService["extractCostValueEnhanced"]("$1,234.56")).toBe(1234.56);
    expect(ProductService["extractCostValueEnhanced"]("€1.234,56")).toBe(1234.56);
  });
});

// Test cases for error handling scenarios
describe("CSV Upload Error Handling", () => {
  let productService: ProductService;
  let testCSVPath: string;

  beforeAll(() => {
    productService = new ProductService();
  });

  afterAll(() => {
    if (fs.existsSync(testCSVPath)) {
      fs.unlinkSync(testCSVPath);
    }
  });

  it("should return errors for missing required fields", async () => {
    // Create a CSV with missing required fields
    const csvContent = `SKU,Name,Cost\nTEST001,Product 1,12.99`;
    testCSVPath = path.join(__dirname, "test_missing_fields.csv");
    fs.writeFileSync(testCSVPath, csvContent);
    
    const result = await productService.processCSVUpload(testCSVPath);
    
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Missing required field - Barcode");
    expect(result.imported).toBe(0);
    expect(result.updated).toBe(0);
  });

  it("should return errors for invalid cost values", async () => {
    // Create a CSV with invalid cost values
    const csvContent = `SKU,Name,Cost,Barcode\nTEST001,Product 1,invalid_cost,1234567890123`;
    testCSVPath = path.join(__dirname, "test_invalid_cost.csv");
    fs.writeFileSync(testCSVPath, csvContent);
    
    const result = await productService.processCSVUpload(testCSVPath);
    
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Invalid cost value");
    expect(result.imported).toBe(0);
    expect(result.updated).toBe(0);
  });

  it("should return errors for values that exceed length limits", async () => {
    // Create a CSV with values exceeding length limits
    const longName = "Product with a very long name that exceeds the maximum allowed length for testing purposes";
    const csvContent = `SKU,Name,Cost,Barcode\nTEST001,${longName},12.99,1234567890123`;
    testCSVPath = path.join(__dirname, "test_length_error.csv");
    fs.writeFileSync(testCSVPath, csvContent);
    
    const result = await productService.processCSVUpload(testCSVPath);
    
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Name too long");
    expect(result.imported).toBe(0);
    expect(result.updated).toBe(0);
  });

  it("should return errors when required headers are missing", async () => {
    // Create a CSV without required headers
    const csvContent = `WrongHeader1,WrongHeader2,WrongHeader3,WrongHeader4\nTEST001,Product 1,12.99,1234567890123`;
    testCSVPath = path.join(__dirname, "test_missing_headers.csv");
    fs.writeFileSync(testCSVPath, csvContent);
    
    const result = await productService.processCSVUpload(testCSVPath);
    
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Missing required column header for SKU");
    expect(result.imported).toBe(0);
    expect(result.updated).toBe(0);
  });
});

// Update the existing CSV processing test to include more comprehensive checks
describe("Comprehensive CSV Processing Tests", () => {
  let productService: ProductService;
  let testCSVPath: string;

  beforeAll(() => {
    productService = new ProductService();
  });

  afterAll(() => {
    if (fs.existsSync(testCSVPath)) {
      fs.unlinkSync(testCSVPath);
    }
  });

  it("should process CSV with various currency formats", async () => {
    const csvContent = `SKU,Name,Cost,Barcode
TEST001,Product 1,$12.99,1234567890123
TEST002,Product 2,€15.50,1234567890124
TEST003,Product 3,GBP 20.75,1234567890125
TEST004,Product 4,¥1000,1234567890126
TEST005,Product 5,AUD$ 35.99,1234567890127`;
    
    testCSVPath = path.join(__dirname, "test_currency_formats.csv");
    fs.writeFileSync(testCSVPath, csvContent);

    const result = await productService.processCSVUpload(testCSVPath);
    
    expect(result.errors.length).toBe(0);
    expect(result.imported).toBe(5);
    expect(result.updated).toBe(0);
  });

  it("should process CSV with alternative header names", async () => {
    const csvContent = `Item Code,Product Name,Unit Price,GTIN
TEST001,Product 1,12.99,1234567890123
TEST002,Product 2,15.50,1234567890124
TEST003,Product 3,20.75,1234567890125`;
    
    testCSVPath = path.join(__dirname, "test_alt_headers.csv");
    fs.writeFileSync(testCSVPath, csvContent);

    const result = await productService.processCSVUpload(testCSVPath);
    
    expect(result.errors.length).toBe(0);
    expect(result.imported).toBe(3);
    expect(result.updated).toBe(0);
  });
});