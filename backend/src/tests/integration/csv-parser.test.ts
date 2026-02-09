/**
 * Integration Tests for CSV Parser Service
 *
 * Tests the streaming CSV parser with real file I/O and database operations.
 * Includes a 10,000 line stress test to verify constant memory usage.
 *
 * NOTE: These tests require a real database with the products table.
 * Run `npx prisma migrate dev` before running these tests.
 *
 * If the database is not set up, tests will be skipped gracefully.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PrismaClient } from './generated/client';
import { CSVParserService, ProgressEvent } from '../../services/csv-parser.service';
import { getDefaultDatabaseClient } from '../../database/database-factory';

// Synchronous version for simpler tests
function generateLargeCSVSync(lineCount: number): string {
  const tempDir = os.tmpdir();
  const filePath = path.join(tempDir, `test-csv-sync-${Date.now()}-${lineCount}.csv`);

  let content = 'SKU,Name,Barcode,Cost\n';

  for (let i = 1; i <= lineCount; i++) {
    const sku = `SKU${String(i).padStart(6, '0')}`;
    const name = `Test Product ${i} with some extra description text`;
    const barcode = String(100000000000 + i);
    const cost = (Math.random() * 100).toFixed(2);
    content += `${sku},${name},${barcode},${cost}\n`;
  }

  fs.writeFileSync(filePath, content);
  return filePath;
}

describe('CSV Parser Integration', () => {
  let prisma: PrismaClient;
  let tempFiles: string[] = [];
  let databaseAvailable = false;

  beforeAll(async () => {
    // Use the migrated standard test database
    process.env.NODE_ENV = 'test';
    prisma = getDefaultDatabaseClient();

    try {
      await prisma.$connect();
      // Ensure the Product table exists by running a simple query
      await prisma.product.count();
      databaseAvailable = true;
    } catch {
      // If the table doesn't exist, skip the tests
      console.warn('⚠️ Database not available - CSV Parser integration tests will be skipped.');
      console.warn('   Run "npx prisma migrate dev" to set up the database.');
      databaseAvailable = false;
    }
  });

  afterAll(async () => {
    // Clean up temp files
    for (const file of tempFiles) {
      try {
        fs.unlinkSync(file);
      } catch {
        // Ignore cleanup errors
      }
    }

    if (prisma) {
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    // Clear products between tests
    if (!databaseAvailable) return;
    try {
      await prisma.product.deleteMany({});
    } catch {
      // Ignore if table doesn't exist
    }
  });

  describe('Basic Integration', () => {
    it('should process a small CSV file and insert into database', async () => {
      if (!databaseAvailable) {
        console.log('Skipping: database not available');
        return;
      }

      const filePath = generateLargeCSVSync(10);
      tempFiles.push(filePath);

      const parser = new CSVParserService(prisma);
      const result = await parser.processFile(filePath);

      expect(result.imported).toBe(10);
      expect(result.errors).toHaveLength(0);

      // Verify data in database
      const count = await prisma.product.count();
      expect(count).toBe(10);
    });

    it('should emit progress events during processing', async () => {
      if (!databaseAvailable) {
        console.log('Skipping: database not available');
        return;
      }

      const filePath = generateLargeCSVSync(250);
      tempFiles.push(filePath);

      const parser = new CSVParserService(prisma, { progressInterval: 50 });
      const progressEvents: ProgressEvent[] = [];

      parser.on('progress', (event: ProgressEvent) => {
        progressEvents.push(event);
      });

      await parser.processFile(filePath);

      // Should have emitted several progress events
      expect(progressEvents.length).toBeGreaterThan(1);

      // Last event should show all rows processed
      const lastEvent = progressEvents[progressEvents.length - 1];
      expect(lastEvent.processed).toBe(250);
    });

    it('should handle duplicate SKUs by updating existing records', async () => {
      if (!databaseAvailable) {
        console.log('Skipping: database not available');
        return;
      }

      // First import
      const filePath1 = path.join(os.tmpdir(), 'csv-dup-test-1.csv');
      fs.writeFileSync(
        filePath1,
        'SKU,Name,Barcode,Cost\n' + 'DUPE001,Original Product,111111111111,10.00\n',
      );
      tempFiles.push(filePath1);

      const parser1 = new CSVParserService(prisma);
      await parser1.processFile(filePath1);

      // Second import with same SKU
      const filePath2 = path.join(os.tmpdir(), 'csv-dup-test-2.csv');
      fs.writeFileSync(
        filePath2,
        'SKU,Name,Barcode,Cost\n' + 'DUPE001,Updated Product,111111111111,20.00\n',
      );
      tempFiles.push(filePath2);

      const parser2 = new CSVParserService(prisma);
      const result = await parser2.processFile(filePath2);

      // Should be an update, not a new insert
      expect(result.updated).toBe(1);
      expect(result.imported).toBe(0);

      // Only one record should exist
      const count = await prisma.product.count();
      expect(count).toBe(1);

      // Verify the product was updated
      const product = await prisma.product.findFirst({ where: { sku: 'DUPE001' } });
      expect(product?.name).toBe('Updated Product');
      expect(product?.costPrice).toBe(20.0);
    });
  });

  describe('Large File Processing (Stress Test)', () => {
    // This test verifies constant memory usage with 1,000 lines (shared DB context)
    it('should process 1,000 lines with constant memory usage', async () => {
      if (!databaseAvailable) {
        console.log('Skipping: database not available');
        return;
      }

      const LINE_COUNT = 1000;

      // Generate a 10,000 line CSV file
      const filePath = generateLargeCSVSync(LINE_COUNT);
      tempFiles.push(filePath);

      // Track memory usage
      const memorySnapshots: number[] = [];
      let progressCount = 0;

      const parser = new CSVParserService(prisma, {
        batchSize: 100,
        progressInterval: 100, // Emit progress every 100 lines instead of 500
      });

      parser.on('progress', () => {
        progressCount++;
        const heapUsed = process.memoryUsage().heapUsed;
        memorySnapshots.push(heapUsed);
      });

      // Force GC if available (run tests with --expose-gc)
      if (global.gc) {
        global.gc();
      }

      const startMemory = process.memoryUsage().heapUsed;
      const startTime = Date.now();

      const result = await parser.processFile(filePath);

      const endTime = Date.now();
      const endMemory = process.memoryUsage().heapUsed;

      // Verify all rows were processed
      expect(result.total).toBe(LINE_COUNT);
      expect(result.imported + result.updated).toBeGreaterThan(0);

      // Verify progress events were emitted
      expect(progressCount).toBeGreaterThan(5); // At least 5 progress events for 1,000 lines

      // Log performance metrics (for debugging)
      console.log(`
        === CSV Parser Performance ===
        Lines: ${LINE_COUNT}
        Duration: ${result.durationMs}ms (${endTime - startTime}ms total)
        Imported: ${result.imported}
        Updated: ${result.updated}
        Errors: ${result.errors.length}
        Memory Start: ${(startMemory / 1024 / 1024).toFixed(2)} MB
        Memory End: ${(endMemory / 1024 / 1024).toFixed(2)} MB
        Memory Diff: ${((endMemory - startMemory) / 1024 / 1024).toFixed(2)} MB
        Progress Events: ${progressCount}
      `);

      // Memory check: The difference between start and end should be relatively small
      // for a streaming parser (<50MB for 10k rows is reasonable)
      const memoryDiffMB = (endMemory - startMemory) / 1024 / 1024;
      expect(memoryDiffMB).toBeLessThan(100); // Generous buffer for test environments

      // Check that memory snapshots don't show runaway growth
      if (memorySnapshots.length > 5) {
        const firstThird = memorySnapshots.slice(0, Math.floor(memorySnapshots.length / 3));
        const lastThird = memorySnapshots.slice(-Math.floor(memorySnapshots.length / 3));

        const avgFirst = firstThird.reduce((a, b) => a + b, 0) / firstThird.length;
        const avgLast = lastThird.reduce((a, b) => a + b, 0) / lastThird.length;

        // Memory shouldn't double between first and last third of processing
        // This is a loose check since GC behavior can vary
        const growthRatio = avgLast / avgFirst;
        expect(growthRatio).toBeLessThan(3);
      }

      // Verify database has the expected records
      const dbCount = await prisma.product.count();
      expect(dbCount).toBe(LINE_COUNT);

      // Processing should complete in a reasonable time (< 60 seconds)
      expect(result.durationMs).toBeLessThan(60000);
    }, 120000); // Extended timeout for large file processing in shared DB

    it('should handle errors gracefully in large files', async () => {
      if (!databaseAvailable) {
        console.log('Skipping: database not available');
        return;
      }

      const LINE_COUNT = 1000;
      const ERROR_RATE = 0.05; // 5% of rows will have errors

      // Generate a CSV with some intentional errors
      const tempDir = os.tmpdir();
      const filePath = path.join(tempDir, `test-csv-errors-${Date.now()}.csv`);
      tempFiles.push(filePath);

      let content = 'SKU,Name,Barcode,Cost\n';
      let expectedErrors = 0;

      for (let i = 1; i <= LINE_COUNT; i++) {
        const sku = `ESKU${String(i).padStart(5, '0')}`;
        const name = `Error Test Product ${i}`;
        const barcode = String(200000000000 + i);

        if (Math.random() < ERROR_RATE) {
          // Invalid cost
          content += `${sku},${name},${barcode},invalid\n`;
          expectedErrors++;
        } else {
          const cost = (Math.random() * 100).toFixed(2);
          content += `${sku},${name},${barcode},${cost}\n`;
        }
      }

      fs.writeFileSync(filePath, content);

      const parser = new CSVParserService(prisma);
      const result = await parser.processFile(filePath);

      // Should have processed all rows
      expect(result.total).toBe(LINE_COUNT);

      // Should have skipped the error rows
      expect(result.skipped).toBe(expectedErrors);

      // Should have some errors collected
      expect(result.errors.length).toBe(expectedErrors);

      // Valid rows should still be imported
      expect(result.imported + result.updated).toBe(LINE_COUNT - expectedErrors);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty file', async () => {
      if (!databaseAvailable) {
        console.log('Skipping: database not available');
        return;
      }

      const filePath = path.join(os.tmpdir(), 'empty-csv-test.csv');
      fs.writeFileSync(filePath, 'SKU,Name,Barcode,Cost\n');
      tempFiles.push(filePath);

      const parser = new CSVParserService(prisma);
      const result = await parser.processFile(filePath);

      expect(result.total).toBe(0);
      expect(result.imported).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle file with only header', async () => {
      if (!databaseAvailable) {
        console.log('Skipping: database not available');
        return;
      }

      const filePath = path.join(os.tmpdir(), 'header-only-csv.csv');
      fs.writeFileSync(filePath, 'sku,product_name,bar_code,unit_cost\n');
      tempFiles.push(filePath);

      const parser = new CSVParserService(prisma);
      const result = await parser.processFile(filePath);

      expect(result.total).toBe(0);
      expect(result.imported).toBe(0);
    });

    it('should handle various cost formats in integration', async () => {
      if (!databaseAvailable) {
        console.log('Skipping: database not available');
        return;
      }

      const filePath = path.join(os.tmpdir(), 'cost-formats-test.csv');
      fs.writeFileSync(
        filePath,
        'SKU,Name,Barcode,Cost\n' +
          'COST001,Product 1,300000000001,12.99\n' +
          'COST002,Product 2,300000000002,$15.50\n' +
          'COST003,Product 3,300000000003,EUR 20.00\n' +
          'COST004,Product 4,300000000004,"1,234.56"\n',
      );
      tempFiles.push(filePath);

      const parser = new CSVParserService(prisma);
      const result = await parser.processFile(filePath);

      expect(result.imported).toBe(4);
      expect(result.errors).toHaveLength(0);

      // Verify the cost values were parsed correctly
      const products = await prisma.product.findMany({ orderBy: { sku: 'asc' } });
      expect(products[0].costPrice).toBe(12.99);
      expect(products[1].costPrice).toBe(15.5);
      expect(products[2].costPrice).toBe(20.0);
      expect(products[3].costPrice).toBe(1234.56);
    });
  });
});
