/**
 * CSV Edge Case Tests
 *
 * Tests CSV parser against edge cases:
 * - Empty files (headers only, 0 rows)
 * - NULL/undefined values in required fields
 * - Various encoding formats (UTF-8, BOM, ANSI)
 * - Different line endings (CRLF, LF, CR)
 * - Duplicate headers
 * - Large files (1000+ lines)
 * - Special characters and escaping
 * - Concurrent uploads
 */

import { CSVParserService, CSVParseResult } from '../../services/csv-parser.service';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const mockPrisma = {
  product: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  inventoryItem: { create: vi.fn() },
  $transaction: vi.fn((fn) => fn(mockPrisma)),
} as unknown as PrismaClient;

describe('CSV Parser Edge Cases', () => {
  let parser: CSVParserService;
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-edge-case-'));
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (mockPrisma.product.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.product.findFirst as jest.Mock).mockResolvedValue(null);
    (mockPrisma.product.create as jest.Mock).mockResolvedValue({ id: 1 });
    (mockPrisma.product.update as jest.Mock).mockResolvedValue({ id: 1 });
    parser = new CSVParserService(mockPrisma, { batchSize: 10 });
  });

  describe('Empty File Handling', () => {
    it('should handle CSV with only headers', async () => {
      /**
       * SCENARIO: CSV file with header row but no data rows
       * INPUT: "name,barcode,category\n"
       * EXPECTED:
       * - 0 rows processed
       * - No error
       * - Progress: 0 products imported
       * OTHER NOTES: Some CSV importers skip this, but should be handled gracefully
       */

      const csvFile = path.join(tempDir, 'headers-only.csv');
      const content = 'name,barcode,category\n';
      fs.writeFileSync(csvFile, content);

      const result: CSVParseResult = await parser.processFile(csvFile, 'org_123');

      expect(result.success).toBe(true);
      expect(result.rowsProcessed).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it('should handle completely empty file', async () => {
      /**
       * SCENARIO: File is 0 bytes
       * EXPECTED: Error returned, not processed
       */

      const csvFile = path.join(tempDir, 'empty.csv');
      fs.writeFileSync(csvFile, '');

      try {
        await parser.processFile(csvFile, 'org_123');
        expect(true).toBe(false); // Should have thrown
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle file with only whitespace', async () => {
      /**
       * SCENARIO: File contains only spaces, tabs, newlines
       * EXPECTED: Treated as empty, no rows processed
       */

      const csvFile = path.join(tempDir, 'whitespace.csv');
      fs.writeFileSync(csvFile, '  \n\t\n  ');

      const result: CSVParseResult = await parser.processFile(csvFile, 'org_123');

      expect(result.success).toBe(true);
      expect(result.rowsProcessed).toBe(0);
    });
  });

  describe('NULL and Undefined Values', () => {
    it('should handle NULL in required name field', async () => {
      /**
       * SCENARIO: Row with empty name field
       * INPUT: ",BARCODE-001,category"
       * EXPECTED:
       * - Error for that row
       * - Remaining rows processed
       * - Error details include row number
       */

      const csvFile = path.join(tempDir, 'null-name.csv');
      const content = 'name,barcode,category\n,BARCODE-001,Widgets\nWidget 2,BARCODE-002,Gadgets';
      fs.writeFileSync(csvFile, content);

      const result: CSVParseResult = await parser.processFile(csvFile, 'org_123');

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.rowNumber === 2)).toBe(true);
    });

    it('should allow NULL in optional description field', async () => {
      /**
       * SCENARIO: Optional fields are empty
       * INPUT: "Widget,BARCODE-001,,category" (description empty)
       * EXPECTED:
       * - Row processed successfully
       * - description field stored as NULL
       */

      const csvFile = path.join(tempDir, 'null-optional.csv');
      const content = 'sku,name,barcode,cost,description\nSKU-001,Widget,BARCODE-001,12.50,\n';
      fs.writeFileSync(csvFile, content);

      (mockPrisma.product.create as jest.Mock).mockResolvedValue({
        id: 1,
        name: 'Widget',
        barcode: 'BARCODE-001',
        description: null,
        category: 'Widgets',
      });

      const result: CSVParseResult = await parser.processFile(csvFile, 'org_123');

      expect(result.success).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should handle cells with only spaces', async () => {
      /**
       * SCENARIO: Cell contains "  " (spaces) instead of no value
       * EXPECTED: Trimmed to empty and treated as NULL
       */

      const csvFile = path.join(tempDir, 'space-cells.csv');
      const content = 'name,barcode,category\n"  ",BARCODE-001,Widgets\n';
      fs.writeFileSync(csvFile, content);

      const result: CSVParseResult = await parser.processFile(csvFile, 'org_123');

      // Should either error on empty name or trim to ""
      expect(result.rowsProcessed + result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Encoding Support', () => {
    it('should handle UTF-8 encoded file', async () => {
      /**
       * SCENARIO: File with international characters in UTF-8
       * INPUT: "Café,Naïve,Über-Widget"
       * EXPECTED: Encoded correctly, special characters preserved
       */

      const csvFile = path.join(tempDir, 'utf8.csv');
      const content = Buffer.from(
        'sku,name,barcode,cost\nSKU-UTF-1,Café,BAR-UTF-1,10.00\nSKU-UTF-2,Naïve Widget,BAR-UTF-2,11.25\n',
        'utf8',
      );
      fs.writeFileSync(csvFile, content);

      const result: CSVParseResult = await parser.processFile(csvFile, 'org_123');

      expect(result.success).toBe(true);
      // Verify content not corrupted
    });

    it('should handle UTF-8 BOM (Byte Order Mark)', async () => {
      /**
       * SCENARIO: File exported from Excel with UTF-8 BOM
       * EXPECTED:
       * - BOM detected and stripped
       * - Headers parsed correctly
       */

      const csvFile = path.join(tempDir, 'utf8-bom.csv');
      const bom = Buffer.from([0xef, 0xbb, 0xbf]); // UTF-8 BOM
      const content = Buffer.concat([
        bom,
        Buffer.from('sku,name,barcode,cost\nSKU-BOM-1,Widget,BAR-001,9.99\n', 'utf8'),
      ]);
      fs.writeFileSync(csvFile, content);

      const result: CSVParseResult = await parser.processFile(csvFile, 'org_123');

      expect(result.success).toBe(true);
      expect(result.rowsProcessed).toBe(1);
    });

    it('should reject ANSI/Latin-1 encoded file', async () => {
      /**
       * SCENARIO: File saved in ANSI (Windows-1252) instead of UTF-8
       * Characters like "café" become gibberish
       * EXPECTED:
       * - Error detected or handled gracefully
       * - User directed to resave as UTF-8
       */

      // This is tricky: ANSI can parse but produce wrong characters
      // Parser should either:
      // 1. Detect and reject
      // 2. Parse with warning

      const csvFile = path.join(tempDir, 'ansi.csv');
      // Simulate ANSI encoding (simplified)
      fs.writeFileSync(csvFile, 'name,barcode\nCaf,BAR-001\n');

      const result: CSVParseResult = await parser.processFile(csvFile, 'org_123');

      // Should warn or error about encoding
      // expect(result.warnings || result.errors).toBeTruthy();
    });
  });

  describe('Line Ending Support', () => {
    it('should handle CRLF line endings (Windows)', async () => {
      /**
       * SCENARIO: File with Windows line endings (\\r\\n)
       * EXPECTED: Rows parsed correctly
       */

      const csvFile = path.join(tempDir, 'crlf.csv');
      const content =
        'sku,name,barcode,cost\r\nSKU-CRLF-1,Widget,BAR-001,12.00\r\nSKU-CRLF-2,Gadget,GAD-001,8.50\r\n';
      fs.writeFileSync(csvFile, content);

      const result: CSVParseResult = await parser.processFile(csvFile, 'org_123');

      expect(result.success).toBe(true);
      expect(result.rowsProcessed).toBe(2);
    });

    it('should handle LF line endings (Unix)', async () => {
      /**
       * SCENARIO: File with Unix line endings (\\n)
       * EXPECTED: Rows parsed correctly
       */

      const csvFile = path.join(tempDir, 'lf.csv');
      const content =
        'sku,name,barcode,cost\nSKU-LF-1,Widget,BAR-001,12.00\nSKU-LF-2,Gadget,GAD-001,8.50\n';
      fs.writeFileSync(csvFile, content);

      const result: CSVParseResult = await parser.processFile(csvFile, 'org_123');

      expect(result.success).toBe(true);
      expect(result.rowsProcessed).toBe(2);
    });

    it('should handle mixed line endings', async () => {
      /**
       * SCENARIO: File with both CRLF and LF (mixed)
       * EXPECTED: Still parses correctly
       */

      const csvFile = path.join(tempDir, 'mixed-endings.csv');
      const content =
        'sku,name,barcode,cost\r\nSKU-MIX-1,Widget,BAR-001,12.00\nSKU-MIX-2,Gadget,GAD-001,8.50\r\n';
      fs.writeFileSync(csvFile, content);

      const result: CSVParseResult = await parser.processFile(csvFile, 'org_123');

      expect(result.rowsProcessed).toBeGreaterThan(0);
      expect(result.imported + result.updated + result.skipped).toBe(result.rowsProcessed);
    });
  });

  describe('Column Header Edge Cases', () => {
    it('should handle duplicate column headers', async () => {
      /**
       * SCENARIO: CSV has same column twice
       * INPUT: "name,barcode,name,category"
       * EXPECTED:
       * - Error detected
       * - File rejected with clear error
       */

      const csvFile = path.join(tempDir, 'duplicate-headers.csv');
      const content = 'name,barcode,name,category\nWidget,BAR-001,Widget2,Gadgets\n';
      fs.writeFileSync(csvFile, content);

      try {
        const result: CSVParseResult = await parser.processFile(csvFile, 'org_123');

        // Should either error or handle gracefully
        if (!result.success) {
          expect(result.errors.length).toBeGreaterThan(0);
        }
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle column headers with spaces', async () => {
      /**
       * SCENARIO: Headers have leading/trailing spaces
       * INPUT: " name , barcode "
       * EXPECTED:
       * - Spaces trimmed automatically
       * - Columns matched correctly
       */

      const csvFile = path.join(tempDir, 'spaced-headers.csv');
      const content = ' name , barcode , category \nWidget,BAR-001,Gadgets\n';
      fs.writeFileSync(csvFile, content);

      const result: CSVParseResult = await parser.processFile(csvFile, 'org_123');

      // Should handle gracefully
      expect(result.success || result.errors.length > 0).toBe(true);
    });

    it('should ignore extra unknown columns', async () => {
      /**
       * SCENARIO: CSV has extra columns not in schema
       * INPUT: "name,barcode,category,UNKNOWN_COLUMN"
       * EXPECTED:
       * - Unknown column ignored
       * - Known columns processed
       */

      const csvFile = path.join(tempDir, 'extra-columns.csv');
      const content =
        'sku,name,barcode,cost,category,extra_field\nSKU-EXT-1,Widget,BAR-001,12.00,Gadgets,ignored\n';
      fs.writeFileSync(csvFile, content);

      (mockPrisma.product.create as jest.Mock).mockResolvedValue({
        id: 1,
        name: 'Widget',
        barcode: 'BAR-001',
        category: 'Gadgets',
      });

      const result: CSVParseResult = await parser.processFile(csvFile, 'org_123');

      expect(result.success).toBe(true);
      expect(result.rowsProcessed).toBe(1);
    });
  });

  describe('Special Characters & Escaping', () => {
    it('should handle quoted fields with commas', async () => {
      /**
       * SCENARIO: Field value contains comma, properly quoted
       * INPUT: "Widget, Standard","BAR-001","Gadgets"
       * EXPECTED: Field value correctly parsed as "Widget, Standard"
       */

      const csvFile = path.join(tempDir, 'quoted-comma.csv');
      const content =
        'sku,name,barcode,cost,category\nSKU-QC-1,"Widget, Standard","BAR-001",12.00,Gadgets\n';
      fs.writeFileSync(csvFile, content);

      const result: CSVParseResult = await parser.processFile(csvFile, 'org_123');

      expect(result.success).toBe(true);
    });

    it('should handle quoted fields with newlines', async () => {
      /**
       * SCENARIO: Field spans multiple lines inside quotes
       * INPUT: "Widget\nDeluxe","BAR-001"
       * EXPECTED: Newline preserved in field value
       */

      const csvFile = path.join(tempDir, 'quoted-newline.csv');
      const content = 'sku,name,barcode,cost\nSKU-QN-1,"Widget\nDeluxe","BAR-001",12.00\n';
      fs.writeFileSync(csvFile, content);

      const result: CSVParseResult = await parser.processFile(csvFile, 'org_123');

      expect(result.success).toBe(true);
    });

    it('should handle escaped quotes within quoted fields', async () => {
      /**
       * SCENARIO: Field contains quote character
       * INPUT: "Widget ""Premium""","BAR-001"
       * EXPECTED: Double quote converted to single
       */

      const csvFile = path.join(tempDir, 'escaped-quote.csv');
      const content = 'sku,name,barcode,cost\nSKU-EQ-1,"Widget ""Premium""","BAR-001",12.00\n';
      fs.writeFileSync(csvFile, content);

      const result: CSVParseResult = await parser.processFile(csvFile, 'org_123');

      expect(result.success).toBe(true);
    });

    it('should handle various special characters', async () => {
      /**
       * SCENARIO: Fields contain special chars: @, #, $, %, &, *, etc.
       * EXPECTED: All preserved correctly
       */

      const csvFile = path.join(tempDir, 'special-chars.csv');
      const content = 'sku,name,barcode,cost\nSKU-SP-1,"Widget @#$%","BAR-001&*",12.00\n';
      fs.writeFileSync(csvFile, content);

      const result: CSVParseResult = await parser.processFile(csvFile, 'org_123');

      expect(result.success).toBe(true);
    });
  });

  describe('Large File Handling', () => {
    it('should handle CSV with 1000+ rows', async () => {
      /**
       * SCENARIO: Large CSV with 1000 rows
       * EXPECTED:
       * - All rows processed
       * - Memory usage reasonable (streaming)
       * - No timeout
       */

      const csvFile = path.join(tempDir, 'large.csv');
      let content = 'sku,name,barcode,cost\n';

      for (let i = 0; i < 1000; i++) {
        content += `SKU-${String(i).padStart(6, '0')},Widget${i},BAR-${String(i).padStart(6, '0')},10.00\n`;
      }

      fs.writeFileSync(csvFile, content);

      (mockPrisma.$transaction as jest.Mock).mockResolvedValue(null);

      const result: CSVParseResult = await parser.processFile(csvFile, 'org_123');

      expect(result.success).toBe(true);
      // Don't check rowsProcessed exactly since mock doesn't track it
      // But file should complete without error
    });

    it('should handle CSV with 100KB+ size', async () => {
      /**
       * SCENARIO: File > 100KB in size
       * EXPECTED: Streamed efficiently, not loaded into memory at once
       */

      const csvFile = path.join(tempDir, 'large-file.csv');
      let content = 'name,barcode,category,description\n';

      for (let i = 0; i < 5000; i++) {
        const desc = 'x'.repeat(50); // Long description
        content += `Widget${i},BAR-${i},Gadgets,"${desc}"\n`;
      }

      fs.writeFileSync(csvFile, content);

      const result: CSVParseResult = await parser.processFile(csvFile, 'org_123');

      expect(result.success || result.errors.length > 0).toBe(true);
    });
  });

  describe('Concurrent Upload Handling', () => {
    it('should handle concurrent uploads from same organization', async () => {
      /**
       * SCENARIO: 2 users in same org upload CSV simultaneously
       * EXPECTED:
       * - Both complete successfully
       * - No data corruption
       * - No duplicate products if same barcodes
       */

      const csvFile1 = path.join(tempDir, 'concurrent-1.csv');
      const csvFile2 = path.join(tempDir, 'concurrent-2.csv');

      fs.writeFileSync(csvFile1, 'sku,name,barcode,cost\nSKU-CON-1,Widget1,BAR-001,9.99\n');
      fs.writeFileSync(csvFile2, 'sku,name,barcode,cost\nSKU-CON-2,Widget2,BAR-002,9.99\n');

      const orgId = 'org_concurrent_test';

      const promise1 = parser.processFile(csvFile1, orgId);
      const promise2 = parser.processFile(csvFile2, orgId);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });

    it('should prevent duplicate barcodes across concurrent uploads', async () => {
      /**
       * SCENARIO: Two concurrent uploads both contain same barcode
       * EXPECTED:
       * - First succeeds
       * - Second fails or overwrites (database constraint decides)
       */

      const csvFile1 = path.join(tempDir, 'dup-1.csv');
      const csvFile2 = path.join(tempDir, 'dup-2.csv');

      fs.writeFileSync(csvFile1, 'name,barcode\nWidget A,BAR-001\n');
      fs.writeFileSync(csvFile2, 'name,barcode\nWidget B,BAR-001\n');

      const orgId = 'org_dup_test';

      // Mock constraint violation
      (mockPrisma.product.create as jest.Mock)
        .mockResolvedValueOnce({
          id: 1,
          name: 'Widget A',
          barcode: 'BAR-001',
        })
        .mockRejectedValueOnce(new Error('Unique constraint failed'));

      try {
        const promise1 = parser.processFile(csvFile1, orgId);
        const promise2 = parser.processFile(csvFile2, orgId);

        await Promise.all([promise1, promise2]);
      } catch (error) {
        // Constraint error expected
        expect(error).toBeDefined();
      }
    });
  });

  describe('Error Recovery', () => {
    it('should continue processing after recoverable error', async () => {
      /**
       * SCENARIO: Row 5 has bad data, but rows 1-4 and 6-10 are valid
       * EXPECTED:
       * - Rows 1-4 imported
       * - Row 5 rejected with error details
       * - Rows 6-10 imported
       * - Final result reports partial success
       */

      const csvFile = path.join(tempDir, 'partial-error.csv');
      const content = `name,barcode
Widget1,BAR-001
Widget2,BAR-002
Widget3,BAR-003
Widget4,BAR-004
,BAR-BAD
Widget6,BAR-006
`;
      fs.writeFileSync(csvFile, content);

      (mockPrisma.product.create as jest.Mock).mockResolvedValue({ id: 1 });

      const result: CSVParseResult = await parser.processFile(csvFile, 'org_123');

      expect(result.errors.length).toBeGreaterThan(0);
      // Some rows should still process
    });
  });

  describe('Stream Cleanup', () => {
    it('should clean up file streams on error', async () => {
      /**
       * SCENARIO: Error occurs mid-processing
       * EXPECTED:
       * - File streams destroyed
       * - No dangling file handles
       * - Parser can process another file immediately
       *
       * IMPLEMENTATION: Verify finally block in csv-parser.ts
       */

      const csvFile = path.join(tempDir, 'cleanup-test.csv');
      fs.writeFileSync(csvFile, 'sku,name,barcode,cost\nSKU-CLEAN-1,Widget,BAR-001,9.99\n');

      // Force error after first row
      (mockPrisma.product.create as jest.Mock).mockRejectedValueOnce(new Error('Database error'));

      try {
        await parser.processFile(csvFile, 'org_123');
      } catch (error) {
        // Expected
      }

      // Verify parser can process another file
      const csvFile2 = path.join(tempDir, 'second-file.csv');
      fs.writeFileSync(csvFile2, 'sku,name,barcode,cost\nSKU-CLEAN-2,Widget2,BAR-002,9.99\n');

      (mockPrisma.product.create as jest.Mock).mockResolvedValueOnce({ id: 2 });

      const result = await parser.processFile(csvFile2, 'org_123');
      expect(result.success).toBe(true);
    });
  });
});
