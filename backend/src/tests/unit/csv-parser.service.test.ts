/**
 * Unit Tests for CSV Parser Service
 *
 * Tests the streaming CSV parser with various fixtures:
 * - Valid CSV files
 * - Invalid/malformed CSV files
 * - CSV injection attempts
 * - Duplicate SKU detection
 * - Various cost formats
 */

import { CSVParserService, CSVParseResult, ProgressEvent } from '../../services/csv-parser.service';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock PrismaClient
const mockTransaction = jest.fn();
const mockFindFirst = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();

const mockPrisma = {
  $transaction: mockTransaction,
  product: {
    findFirst: mockFindFirst,
    create: mockCreate,
    update: mockUpdate,
  },
} as unknown as PrismaClient;

describe('CSVParserService', () => {
  let parser: CSVParserService;
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-parser-test-'));
  });

  afterAll(() => {
    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    parser = new CSVParserService(mockPrisma, {
      batchSize: 2, // Small batch for testing
      progressInterval: 2,
    });

    // Default mock implementations
    mockTransaction.mockImplementation(async (callback) => {
      await callback({
        product: {
          findFirst: mockFindFirst,
          create: mockCreate,
          update: mockUpdate,
        },
      });
    });
    mockFindFirst.mockResolvedValue(null); // No existing products by default
    mockCreate.mockResolvedValue({ id: 1 });
    mockUpdate.mockResolvedValue({ id: 1 });
  });

  /**
   * Helper to create a test CSV file
   */
  function createTestCSV(filename: string, content: string): string {
    const filePath = path.join(tempDir, filename);
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  describe('Constructor and DI', () => {
    it('should create instance with injected PrismaClient', () => {
      const service = new CSVParserService(mockPrisma);
      expect(service).toBeInstanceOf(CSVParserService);
    });

    it('should create instance with default options', () => {
      const service = new CSVParserService(mockPrisma);
      expect(service).toBeInstanceOf(CSVParserService);
    });

    it('should accept custom options', () => {
      const service = new CSVParserService(mockPrisma, {
        batchSize: 50,
        progressInterval: 500,
        maxFileSize: 5 * 1024 * 1024,
      });
      expect(service).toBeInstanceOf(CSVParserService);
    });
  });

  describe('Header Validation', () => {
    it('should accept valid headers with standard names', async () => {
      const filePath = createTestCSV(
        'valid-headers.csv',
        'SKU,Name,Barcode,Cost\n' + 'SKU001,Product 1,123456789,12.99\n',
      );

      const result = await parser.processFile(filePath);

      expect(result.errors.filter((e) => e.field === 'header')).toHaveLength(0);
      expect(result.imported).toBe(1);
    });

    it('should accept alternative header names', async () => {
      const filePath = createTestCSV(
        'alt-headers.csv',
        'Item Code,Item Description,EAN,Cost Price\n' + 'SKU001,Product 1,123456789,12.99\n',
      );

      const result = await parser.processFile(filePath);

      expect(result.errors.filter((e) => e.field === 'header')).toHaveLength(0);
      expect(result.imported).toBe(1);
    });

    it('should report missing required headers', async () => {
      const filePath = createTestCSV('missing-headers.csv', 'SKU,Name\n' + 'SKU001,Product 1\n');

      const result = await parser.processFile(filePath);

      const headerErrors = result.errors.filter((e) => e.field === 'header');
      expect(headerErrors.length).toBeGreaterThan(0);
      expect(headerErrors.some((e) => e.value === 'barcode')).toBe(true);
      expect(headerErrors.some((e) => e.value === 'cost')).toBe(true);
    });

    it('should handle case-insensitive header matching', async () => {
      const filePath = createTestCSV(
        'lowercase-headers.csv',
        'sku,name,barcode,cost\n' + 'SKU001,Product 1,123456789,12.99\n',
      );

      const result = await parser.processFile(filePath);

      expect(result.errors.filter((e) => e.field === 'header')).toHaveLength(0);
      expect(result.imported).toBe(1);
    });
  });

  describe('Row Validation', () => {
    it('should validate required fields', async () => {
      const filePath = createTestCSV(
        'missing-fields.csv',
        'SKU,Name,Barcode,Cost\n' +
          ',Product 1,123456789,12.99\n' +
          'SKU002,,123456789,12.99\n' +
          'SKU003,Product 3,,12.99\n' +
          'SKU004,Product 4,123456789,\n',
      );

      const result = await parser.processFile(filePath);

      expect(result.skipped).toBe(4);
      expect(result.errors.some((e) => e.field === 'sku')).toBe(true);
      expect(result.errors.some((e) => e.field === 'name')).toBe(true);
      expect(result.errors.some((e) => e.field === 'barcode')).toBe(true);
      expect(result.errors.some((e) => e.field === 'cost')).toBe(true);
    });

    it('should validate cost format', async () => {
      const filePath = createTestCSV(
        'invalid-cost.csv',
        'SKU,Name,Barcode,Cost\n' +
          'SKU001,Product 1,123456789,invalid\n' +
          'SKU002,Product 2,123456790,abc123\n',
      );

      const result = await parser.processFile(filePath);

      expect(result.skipped).toBe(2);
      expect(result.errors.filter((e) => e.field === 'cost')).toHaveLength(2);
    });
  });

  describe('Cost Parsing', () => {
    it('should parse various valid cost formats', async () => {
      const filePath = createTestCSV(
        'cost-formats.csv',
        'SKU,Name,Barcode,Cost\n' +
          'SKU001,Product 1,123456781,12.99\n' +
          'SKU002,Product 2,123456782,$15.50\n' +
          'SKU003,Product 3,123456783,€20,50\n' +
          'SKU004,Product 4,123456784,1,234.56\n' +
          'SKU005,Product 5,123456785,1.234,56\n',
      );

      const result = await parser.processFile(filePath);

      // All should be parsed successfully
      expect(result.imported).toBe(5);
      expect(result.errors.filter((e) => e.field === 'cost')).toHaveLength(0);
    });

    it('should handle negative values in parentheses', async () => {
      const filePath = createTestCSV(
        'negative-cost.csv',
        'SKU,Name,Barcode,Cost\n' + 'SKU001,Product 1,123456789,(12.99)\n',
      );

      const result = await parser.processFile(filePath);

      expect(result.imported).toBe(1);
    });
  });

  describe('CSV Injection Protection', () => {
    it('should sanitize values starting with dangerous characters', async () => {
      const filePath = createTestCSV(
        'injection-attempt.csv',
        'SKU,Name,Barcode,Cost\n' +
          '=CMD|calc,Product 1,123456789,12.99\n' +
          '+SUM(A1:A10),Product 2,123456790,15.99\n' +
          '-1+1,Product 3,123456791,18.99\n' +
          '@SUM(A1),Product 4,123456792,21.99\n',
      );

      const result = await parser.processFile(filePath);

      // All rows should be processed (sanitized, not rejected)
      expect(result.imported).toBe(4);

      // Verify create was called with sanitized values
      const createCalls = mockCreate.mock.calls;
      expect(createCalls[0][0].data.sku).toBe("'=CMD|calc");
      expect(createCalls[1][0].data.sku).toBe("'+SUM(A1:A10)");
      expect(createCalls[2][0].data.sku).toBe("'-1+1");
      expect(createCalls[3][0].data.sku).toBe("'@SUM(A1)");
    });
  });

  describe('Duplicate SKU Detection', () => {
    it('should detect duplicate SKUs within the same file', async () => {
      const filePath = createTestCSV(
        'duplicate-sku.csv',
        'SKU,Name,Barcode,Cost\n' +
          'SKU001,Product 1,123456789,12.99\n' +
          'SKU001,Product 1 Duplicate,123456790,15.99\n' +
          'SKU002,Product 2,123456791,18.99\n',
      );

      const result = await parser.processFile(filePath);

      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.errors.some((e) => e.field === 'sku' && e.message.includes('Duplicate'))).toBe(
        true,
      );
    });

    it('should handle case-insensitive duplicate detection', async () => {
      const filePath = createTestCSV(
        'case-duplicate.csv',
        'SKU,Name,Barcode,Cost\n' +
          'sku001,Product 1,123456789,12.99\n' +
          'SKU001,Product 1 Upper,123456790,15.99\n',
      );

      const result = await parser.processFile(filePath);

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
    });
  });

  describe('Batch Processing', () => {
    it('should process rows in batches', async () => {
      const filePath = createTestCSV(
        'batch-test.csv',
        'SKU,Name,Barcode,Cost\n' +
          'SKU001,Product 1,123456781,12.99\n' +
          'SKU002,Product 2,123456782,13.99\n' +
          'SKU003,Product 3,123456783,14.99\n' +
          'SKU004,Product 4,123456784,15.99\n' +
          'SKU005,Product 5,123456785,16.99\n',
      );

      await parser.processFile(filePath);

      // With batchSize=2, we should have 3 transaction calls (2+2+1)
      expect(mockTransaction).toHaveBeenCalledTimes(3);
    });

    it('should handle updates for existing products', async () => {
      // Mock findFirst to return existing product for first row
      mockFindFirst.mockResolvedValueOnce({ id: 1, sku: 'SKU001' });
      mockFindFirst.mockResolvedValue(null);

      const filePath = createTestCSV(
        'update-test.csv',
        'SKU,Name,Barcode,Cost\n' +
          'SKU001,Product 1 Updated,123456789,15.99\n' +
          'SKU002,Product 2,123456790,12.99\n',
      );

      const result = await parser.processFile(filePath);

      expect(result.updated).toBe(1);
      expect(result.imported).toBe(1);
    });
  });

  describe('Progress Events', () => {
    it('should emit progress events', async () => {
      const progressEvents: ProgressEvent[] = [];
      parser.on('progress', (event) => {
        progressEvents.push(event);
      });

      const filePath = createTestCSV(
        'progress-test.csv',
        'SKU,Name,Barcode,Cost\n' +
          'SKU001,Product 1,123456781,12.99\n' +
          'SKU002,Product 2,123456782,13.99\n' +
          'SKU003,Product 3,123456783,14.99\n' +
          'SKU004,Product 4,123456784,15.99\n',
      );

      await parser.processFile(filePath);

      // With progressInterval=2, should emit at row 2 and 4
      expect(progressEvents.length).toBeGreaterThanOrEqual(2);
    });

    it('should emit complete event', async () => {
      let completeResult: CSVParseResult | null = null;
      parser.on('complete', (result) => {
        completeResult = result;
      });

      const filePath = createTestCSV(
        'complete-test.csv',
        'SKU,Name,Barcode,Cost\n' + 'SKU001,Product 1,123456789,12.99\n',
      );

      await parser.processFile(filePath);

      expect(completeResult).not.toBeNull();
      expect(completeResult!.total).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle file not found', async () => {
      await expect(parser.processFile('/nonexistent/file.csv')).rejects.toThrow('File not found');
    });

    it('should continue processing after row errors when skipInvalidRows is true', async () => {
      const filePath = createTestCSV(
        'mixed-errors.csv',
        'SKU,Name,Barcode,Cost\n' +
          'SKU001,Product 1,123456789,12.99\n' +
          ',Missing SKU,123456790,13.99\n' +
          'SKU003,Product 3,123456791,14.99\n',
      );

      const result = await parser.processFile(filePath);

      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.total).toBe(3);
    });

    it('should include duration in result', async () => {
      const filePath = createTestCSV(
        'duration-test.csv',
        'SKU,Name,Barcode,Cost\n' + 'SKU001,Product 1,123456789,12.99\n',
      );

      const result = await parser.processFile(filePath);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('File Size Validation', () => {
    it('should reject files exceeding max size', async () => {
      const smallParser = new CSVParserService(mockPrisma, {
        maxFileSize: 100, // Very small limit
      });

      // Create a file larger than 100 bytes
      const content =
        'SKU,Name,Barcode,Cost\n' +
        'SKU001,Product Name That Is Very Long,123456789,12.99\n'.repeat(10);
      const filePath = createTestCSV('large-file.csv', content);

      await expect(smallParser.processFile(filePath)).rejects.toThrow('exceeds maximum');
    });
  });
});
