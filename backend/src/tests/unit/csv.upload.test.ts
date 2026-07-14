/* eslint-disable @typescript-eslint/no-explicit-any */
import { ProductService } from '../../services/product.service';
import { findColumnByAlternatives } from '../../services/product-import.helpers';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import type { SupplierCreditRepository } from '../../repositories/supplier-credit.repository';

describe('CSV Upload Functionality Tests', () => {
  let productService: ProductService;
  let mockPrisma: any;
  let enrichmentRepository: Pick<SupplierCreditRepository, 'enrichImportedProduct'>;

  beforeEach(() => {
    mockPrisma = {
      product: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      organizationUsage: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ organizationId: 'default-org', totalSkus: 0, maxSkus: 1000 }),
        update: vi.fn(),
      },
      $transaction: vi.fn((callback) => callback(mockPrisma)),
    };
    enrichmentRepository = { enrichImportedProduct: vi.fn(async () => undefined) };
    productService = new ProductService(
      mockPrisma as unknown as PrismaClient,
      undefined,
      undefined,
      undefined,
      enrichmentRepository as SupplierCreditRepository,
    );
  });

  it('should process CSV with basic format correctly', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(null); // No existing products
    // Simplify mock to return a valid object always
    mockPrisma.product.create.mockImplementation((args: any) =>
      Promise.resolve({
        id: 1,
        name: 'Test Product',
        sku: 'TEST001',
        costPrice: 10.0,
        barcode: '123456789',
        ...args.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    const csvContent = `SKU,Name,Cost,Barcode
TEST001,Product 1,$12.99,1234567890123
TEST002,Product 2,€15.50,1234567890124
TEST003,Product 3,"1,000.99",1234567890125`;
    const testCSVPath = path.join(__dirname, 'test.csv');
    fs.writeFileSync(testCSVPath, csvContent);

    try {
      const result = await productService.processCSVUploadInternal(testCSVPath);

      expect(result.errors.length).toBe(0);
      expect(result.imported).toBe(3); // All 3 rows should be imported
      expect(result.updated).toBe(0); // No updates since it's first import
      expect(enrichmentRepository.enrichImportedProduct).toHaveBeenCalledTimes(3);
      expect(enrichmentRepository.enrichImportedProduct).toHaveBeenCalledWith('default-org', {
        productId: 1,
        barcode: '1234567890123',
        sku: 'TEST001',
      });
    } finally {
      if (fs.existsSync(testCSVPath)) {
        fs.unlinkSync(testCSVPath);
      }
    }
  });

  it('does not fail a successful product import when advisory enrichment fails', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(null);
    mockPrisma.product.create.mockResolvedValue({
      id: 9,
      organizationId: 'default-org',
      name: 'Isolated Product',
      sku: 'ISOLATED-1',
      costPrice: 10,
      barcode: 'ISOLATED-BARCODE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(enrichmentRepository.enrichImportedProduct).mockRejectedValueOnce(
      new Error('catalogue unavailable'),
    );
    const testCSVPath = path.join(__dirname, 'enrichment-failure.csv');
    fs.writeFileSync(
      testCSVPath,
      'SKU,Name,Cost,Barcode\nISOLATED-1,Isolated Product,10.00,ISOLATED-BARCODE\n',
    );

    try {
      const result = await productService.processCSVUploadInternal(testCSVPath);
      expect(result).toMatchObject({ imported: 1, updated: 0, errors: [] });
    } finally {
      if (fs.existsSync(testCSVPath)) fs.unlinkSync(testCSVPath);
    }
  });
});

// Test cases for alternative header name recognition
describe('CSV Header Name Recognition', () => {
  it('should recognize alternative SKU column names', () => {
    const row = { 'Item Code': 'SKU123', Name: 'Product', Cost: '10.00', Barcode: '123456' };
    const alternatives = ['SKU', 'Item Code', 'Reorder Number', 'Product Code', 'Item Number'];

    const header = findColumnByAlternatives(row, alternatives);
    expect(header).toBe('Item Code');
  });

  it('should recognize alternative Name column names', () => {
    const row = { SKU: 'SKU123', 'Product Name': 'Product', Cost: '10.00', Barcode: '123456' };
    const alternatives = ['Name', 'Item Description', 'Product Name', 'Description', 'Item Name'];

    const header = findColumnByAlternatives(row, alternatives);
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

    const header = findColumnByAlternatives(row, alternatives);
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

    const header = findColumnByAlternatives(row, alternatives);
    expect(header).toBe('GTIN');
  });

  it('should be case-insensitive for headers', () => {
    const row = { sku: 'SKU123', name: 'Product', cost: '10.00', barcode: '123456' };
    const skuHeader = findColumnByAlternatives(row, ['SKU']);
    const nameHeader = findColumnByAlternatives(row, ['Name']);
    const costHeader = findColumnByAlternatives(row, ['Cost']);
    const barcodeHeader = findColumnByAlternatives(row, ['Barcode']);

    expect(skuHeader).toBe('sku');
    expect(nameHeader).toBe('name');
    expect(costHeader).toBe('cost');
    expect(barcodeHeader).toBe('barcode');
  });
});

// Test cases for currency representation
describe('Currency Representation Handling', () => {
  it('should correctly parse basic numeric values', () => {
    expect(ProductService['extractCostValueEnhanced']('12.34')).toBe(12.34);
    expect(ProductService['extractCostValueEnhanced']('100')).toBe(100);
    expect(ProductService['extractCostValueEnhanced']('0.99')).toBe(0.99);
    expect(ProductService['extractCostValueEnhanced']('1000.00')).toBe(1000.0);
  });

  it('should handle currency symbols at the beginning', () => {
    expect(ProductService['extractCostValueEnhanced']('$12.34')).toBe(12.34);
    expect(ProductService['extractCostValueEnhanced']('€12.34')).toBe(12.34);
    expect(ProductService['extractCostValueEnhanced']('£12.34')).toBe(12.34);
    expect(ProductService['extractCostValueEnhanced']('¥1234')).toBe(1234);
  });

  it('should handle currency symbols at the end', () => {
    expect(ProductService['extractCostValueEnhanced']('12.34$')).toBe(12.34);
    expect(ProductService['extractCostValueEnhanced']('12.34€')).toBe(12.34);
    expect(ProductService['extractCostValueEnhanced']('1234¥')).toBe(1234);
  });

  it('should handle currency abbreviations', () => {
    expect(ProductService['extractCostValueEnhanced']('USD 12.34')).toBe(12.34);
    expect(ProductService['extractCostValueEnhanced']('EUR 12.34')).toBe(12.34);
    expect(ProductService['extractCostValueEnhanced']('GBP 12.34')).toBe(12.34);
    expect(ProductService['extractCostValueEnhanced']('AUD 12.34')).toBe(12.34);
  });

  it('should handle complex currency representations', () => {
    expect(ProductService['extractCostValueEnhanced']('AUD$ 1,234.56')).toBe(1234.56);
    expect(ProductService['extractCostValueEnhanced']('CAD $1,234.56')).toBe(1234.56);
    expect(ProductService['extractCostValueEnhanced']('€ 1.234,56')).toBe(1234.56); // European format
    expect(ProductService['extractCostValueEnhanced']('GBP 1,234.56')).toBe(1234.56);
    expect(ProductService['extractCostValueEnhanced']('¥1,234')).toBe(1234);
    expect(ProductService['extractCostValueEnhanced']('RMB 1,234.56')).toBe(1234.56);
    expect(ProductService['extractCostValueEnhanced']('Rp 1.234,56')).toBe(1234.56);
    expect(ProductService['extractCostValueEnhanced']('$ 1,234.56')).toBe(1234.56);
    expect(ProductService['extractCostValueEnhanced']('  € 1.234,56  ')).toBe(1234.56); // With spaces
  });

  it('should return null for invalid inputs', () => {
    expect(ProductService['extractCostValueEnhanced']('')).toBeNull();
    expect(ProductService['extractCostValueEnhanced']('not a number')).toBeNull();
    expect(ProductService['extractCostValueEnhanced']('abc')).toBeNull();
    expect(ProductService['extractCostValueEnhanced']('@#$%')).toBeNull();
  });
});

// Test cases for flexible data validation with different number formats
describe('Flexible Data Validation for Different Number Formats', () => {
  it('should handle US number format (comma as thousands separator, dot as decimal)', () => {
    expect(ProductService['extractCostValueEnhanced']('1,234.56')).toBe(1234.56);
    expect(ProductService['extractCostValueEnhanced']('12,345.67')).toBe(12345.67);
    expect(ProductService['extractCostValueEnhanced']('1,000,000.99')).toBe(1000000.99);
  });

  it('should handle European number format (dot as thousands separator, comma as decimal)', () => {
    expect(ProductService['extractCostValueEnhanced']('1.234,56')).toBe(1234.56);
    expect(ProductService['extractCostValueEnhanced']('12.345,67')).toBe(12345.67);
    expect(ProductService['extractCostValueEnhanced']('1.000.000,99')).toBe(1000000.99);
  });

  it('should handle mixed formats correctly', () => {
    // When both commas and dots exist, check which one is at the end
    expect(ProductService['extractCostValueEnhanced']('1.234,56')).toBe(1234.56); // European
    expect(ProductService['extractCostValueEnhanced']('1,234.56')).toBe(1234.56); // US
  });

  it('should handle numbers with thousands separators only', () => {
    expect(ProductService['extractCostValueEnhanced']('1,000')).toBe(1000);
    expect(ProductService['extractCostValueEnhanced']('1.000')).toBe(1000);
    // These work now because we fixed the logic
    expect(ProductService['extractCostValueEnhanced']('1,000,000')).toBe(1000000);
    expect(ProductService['extractCostValueEnhanced']('1.000.000')).toBe(1000000);
  });

  it('should handle decimal numbers without thousands separators', () => {
    expect(ProductService['extractCostValueEnhanced']('12.34')).toBe(12.34);
    expect(ProductService['extractCostValueEnhanced']('12,34')).toBe(12.34);
  });

  it('should handle various edge cases', () => {
    // Multiple decimals - likely thousands separators
    expect(ProductService['extractCostValueEnhanced']('12.34.56')).toBe(1234.56);
    expect(ProductService['extractCostValueEnhanced']('1.234.567')).toBe(1234567);
    expect(ProductService['extractCostValueEnhanced']('12,34,56')).toBe(123456);

    // Mixed with currency symbols
    expect(ProductService['extractCostValueEnhanced']('$1,234.56')).toBe(1234.56);
    expect(ProductService['extractCostValueEnhanced']('€1.234,56')).toBe(1234.56);
  });
});

// Test cases for error handling scenarios
describe('CSV Upload Error Handling', () => {
  let productService: ProductService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      product: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      $transaction: vi.fn((callback) => callback(mockPrisma)),
    };
    productService = new ProductService(mockPrisma as unknown as PrismaClient);
  });

  it('should return errors for missing required fields', async () => {
    // Missing Barcode
    mockPrisma.product.findUnique.mockResolvedValue(null);

    // Create a CSV with missing required fields
    const csvContent = `SKU,Name,Cost\nTEST001,Product 1,12.99`;
    const testCSVPath = path.join(__dirname, 'test_missing_fields.csv');
    fs.writeFileSync(testCSVPath, csvContent);

    try {
      const result = await productService.processCSVUploadInternal(testCSVPath);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Missing required field - Barcode');
      expect(result.imported).toBe(0);
      expect(result.updated).toBe(0);
    } finally {
      if (fs.existsSync(testCSVPath)) fs.unlinkSync(testCSVPath);
    }
  });

  it('should return errors for invalid cost values', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(null);

    const csvContent = `SKU,Name,Cost,Barcode\nTEST001,Product 1,invalid_cost,1234567890123`;
    const testCSVPath = path.join(__dirname, 'test_invalid_cost.csv');
    fs.writeFileSync(testCSVPath, csvContent);

    try {
      const result = await productService.processCSVUploadInternal(testCSVPath);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Invalid cost value');
      expect(result.imported).toBe(0);
      expect(result.updated).toBe(0);
    } finally {
      if (fs.existsSync(testCSVPath)) fs.unlinkSync(testCSVPath);
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
    const testCSVPath = path.join(__dirname, 'test_length_error.csv');
    fs.writeFileSync(testCSVPath, csvContent);

    try {
      const result = await productService.processCSVUploadInternal(testCSVPath);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Name too long');
      expect(result.imported).toBe(0);
      expect(result.updated).toBe(0);
    } finally {
      if (fs.existsSync(testCSVPath)) fs.unlinkSync(testCSVPath);
    }
  });

  it('should return errors when required headers are missing', async () => {
    // This fails at header validation stage, so DB logic is not reached, but mock needed for constructor
    const csvContent = `WrongHeader1,WrongHeader2,WrongHeader3,WrongHeader4\nTEST001,Product 1,12.99,1234567890123`;
    const testCSVPath = path.join(__dirname, 'test_missing_headers.csv');
    fs.writeFileSync(testCSVPath, csvContent);

    try {
      const result = await productService.processCSVUploadInternal(testCSVPath);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Missing required field - SKU');
      expect(result.imported).toBe(0);
      expect(result.updated).toBe(0);
    } finally {
      if (fs.existsSync(testCSVPath)) fs.unlinkSync(testCSVPath);
    }
  });
});

describe('Comprehensive CSV Processing Tests', () => {
  let productService: ProductService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      product: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      organizationUsage: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ organizationId: 'default-org', totalSkus: 0, maxSkus: 1000 }),
        update: vi.fn(),
      },
      $transaction: vi.fn((callback) => callback(mockPrisma)),
    };
    productService = new ProductService(mockPrisma as unknown as PrismaClient);
  });

  it('should process CSV with various currency formats', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(null);
    mockPrisma.product.create.mockImplementation((args: any) =>
      Promise.resolve({
        id: 1,
        ...args.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    const csvContent = `SKU,Name,Cost,Barcode
TEST001,Product 1,$12.99,1234567890123
TEST002,Product 2,€15.50,1234567890124
TEST003,Product 3,GBP 20.75,1234567890125
TEST004,Product 4,¥1000,1234567890126
TEST005,Product 5,AUD$ 35.99,1234567890127`;

    const testCSVPath = path.join(__dirname, 'test_currency_formats.csv');
    fs.writeFileSync(testCSVPath, csvContent);

    try {
      const result = await productService.processCSVUploadInternal(testCSVPath);
      expect(result.errors.length).toBe(0);
      expect(result.imported).toBe(5);
      expect(result.updated).toBe(0);
    } finally {
      if (fs.existsSync(testCSVPath)) fs.unlinkSync(testCSVPath);
    }
  });

  it('should process CSV with alternative header names', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(null);
    mockPrisma.product.create.mockImplementation((args: any) =>
      Promise.resolve({
        id: 1,
        ...args.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    const csvContent = `Item Code,Product Name,Unit Price,GTIN
TEST001,Product 1,12.99,1234567890123
TEST002,Product 2,15.50,1234567890124
TEST003,Product 3,20.75,1234567890125`;

    const testCSVPath = path.join(__dirname, 'test_alt_headers.csv');
    fs.writeFileSync(testCSVPath, csvContent);

    try {
      const result = await productService.processCSVUploadInternal(testCSVPath);

      expect(result.errors.length).toBe(0);
      expect(result.imported).toBe(3);
      expect(result.updated).toBe(0);
    } finally {
      if (fs.existsSync(testCSVPath)) fs.unlinkSync(testCSVPath);
    }
  });
});
