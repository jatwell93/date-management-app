/**
 * Performance Profiling Tests for CSV Processing
 *
 * Purpose: Measure CSV processing duration for real-world pharmacy data
 * to ensure Workers 30s CPU limit is not exceeded.
 *
 * Target: <25s for 10,000 rows (safety margin for Workers 30s limit)
 *
 * Test Cases:
 * - Real pharmacy CSV (7,649 products)
 * - Synthetic 10,000 row CSV
 * - Various file sizes for benchmarking
 */

import { CSVParserService, CSVParseResult } from '../../services/csv-parser.service';
import { PrismaClient } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Mock PrismaClient with minimal overhead
const mockTransaction = jest.fn();
const mockFindUnique = jest.fn();
const mockFindFirst = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();

const mockPrisma = {
  $transaction: mockTransaction,
  product: {
    findUnique: mockFindUnique,
    findFirst: mockFindFirst,
    create: mockCreate,
    update: mockUpdate,
  },
} as unknown as PrismaClient;

describe('CSV Processing Performance Profile', () => {
  let parser: CSVParserService;
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-profile-'));
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Fast mock implementations
    mockTransaction.mockImplementation(async (callback) => {
      await callback({
        product: {
          findUnique: mockFindUnique,
          findFirst: mockFindFirst,
          create: mockCreate,
          update: mockUpdate,
        },
      });
    });
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 1 });
    mockUpdate.mockResolvedValue({ id: 1 });

    parser = new CSVParserService(mockPrisma, {
      batchSize: 100,
      progressInterval: 500,
    });
  });

  /**
   * Helper to generate synthetic CSV for benchmarking
   */
  function generateSyntheticCSV(rows: number): string {
    const filePath = path.join(tempDir, `synthetic-${rows}.csv`);
    const header = 'SKU,Name,Cost,Barcode\n';
    const lines = [header];

    for (let i = 1; i <= rows; i++) {
      lines.push(
        `SKU${i},Product ${i},$${(Math.random() * 100).toFixed(2)},${1000000000000 + i}\n`,
      );
    }

    fs.writeFileSync(filePath, lines.join(''));
    return filePath;
  }

  /**
   * Helper to measure processing duration
   */
  async function measureProcessing(filePath: string): Promise<{
    result: CSVParseResult;
    durationMs: number;
    rowsPerSecond: number;
  }> {
    const startTime = performance.now();
    const result = await parser.processFile(filePath, { uploadKey: 'performance-profile' });
    const endTime = performance.now();
    const durationMs = endTime - startTime;
    const rowsPerSecond = Math.round((result.total / durationMs) * 1000);

    return { result, durationMs, rowsPerSecond };
  }

  describe('Real Pharmacy Data (7,649 rows)', () => {
    const realPharmacyCSV = path.join(__dirname, '../fixtures/real-pharmacy-products.csv');

    it('should process real pharmacy CSV within 25s target', async () => {
      // Skip if file doesn't exist (not in repo)
      if (!fs.existsSync(realPharmacyCSV)) {
        console.warn('⚠️  Real pharmacy CSV not found - skipping performance test');
        return;
      }

      const { result, durationMs, rowsPerSecond } = await measureProcessing(realPharmacyCSV);

      console.log('\n📊 Real Pharmacy CSV Performance:');
      console.log(`   Rows: ${result.total}`);
      console.log(`   Duration: ${(durationMs / 1000).toFixed(2)}s`);
      console.log(`   Throughput: ${rowsPerSecond} rows/sec`);
      console.log(`   Imported: ${result.imported}`);
      console.log(`   Updated: ${result.updated}`);
      console.log(`   Skipped: ${result.skipped}`);
      console.log(`   Errors: ${result.errors.length}`);

      // Assert performance targets
      expect(durationMs).toBeLessThan(25000); // <25s for Workers safety margin
      expect(result.imported + result.updated).toBeGreaterThan(7600); // Most rows should succeed
      expect(result.skipped).toBeLessThan(50); // Minimal failures
    }, 30000); // 30s timeout

    it('should provide progress updates during processing', async () => {
      if (!fs.existsSync(realPharmacyCSV)) {
        return;
      }

      const progressUpdates: number[] = [];

      parser.on('progress', (progress) => {
        progressUpdates.push(progress.processed);
      });

      await parser.processFile(realPharmacyCSV, { uploadKey: 'performance-profile' });

      expect(progressUpdates.length).toBeGreaterThan(5); // Multiple progress events
      expect(progressUpdates[progressUpdates.length - 1]).toBeGreaterThan(7600);
    }, 30000);
  });

  describe('Synthetic Benchmarking', () => {
    const benchmarkCases = [
      { rows: 1000, expectedMaxDuration: 3000 }, // <3s
      { rows: 5000, expectedMaxDuration: 12000 }, // <12s
      { rows: 10000, expectedMaxDuration: 25000 }, // <25s
    ];

    benchmarkCases.forEach(({ rows, expectedMaxDuration }) => {
      it(
        `should process ${rows.toLocaleString()} rows within ${expectedMaxDuration / 1000}s`,
        async () => {
          const csvPath = generateSyntheticCSV(rows);

          const { result, durationMs, rowsPerSecond } = await measureProcessing(csvPath);

          console.log(`\n📊 Synthetic ${rows.toLocaleString()} rows:`);
          console.log(`   Duration: ${(durationMs / 1000).toFixed(2)}s`);
          console.log(`   Throughput: ${rowsPerSecond} rows/sec`);

          expect(durationMs).toBeLessThan(expectedMaxDuration);
          expect(result.imported).toBe(rows);
          expect(result.skipped).toBe(0);
        },
        expectedMaxDuration + 5000,
      ); // +5s timeout buffer
    });
  });

  describe('Performance Regression Detection', () => {
    it('should maintain consistent throughput across multiple runs', async () => {
      const csvPath = generateSyntheticCSV(1000);
      const throughputs: number[] = [];

      for (let i = 0; i < 3; i++) {
        const { rowsPerSecond } = await measureProcessing(csvPath);
        throughputs.push(rowsPerSecond);
      }

      const avgThroughput = throughputs.reduce((a, b) => a + b, 0) / throughputs.length;
      const stdDev = Math.sqrt(
        throughputs.reduce((sum, val) => sum + Math.pow(val - avgThroughput, 2), 0) /
          throughputs.length,
      );
      const coefficientOfVariation = (stdDev / avgThroughput) * 100;

      console.log(`\n📊 Throughput Consistency:`);
      console.log(`   Average: ${Math.round(avgThroughput)} rows/sec`);
      console.log(`   Std Dev: ${Math.round(stdDev)} rows/sec`);
      console.log(`   CV: ${coefficientOfVariation.toFixed(2)}%`);

      // Windows runners (local + CI) show higher timer variance for this
      // micro-benchmark; keep stricter guard on non-Windows environments.
      const isWindows = os.platform() === 'win32';
      const maxCoefficientOfVariation = isWindows ? 35 : 25;

      expect(coefficientOfVariation).toBeLessThan(maxCoefficientOfVariation);
    }, 45000);
  });

  describe('Memory Usage (Observation)', () => {
    it('should report memory usage for large file processing', async () => {
      const csvPath = generateSyntheticCSV(5000);

      const memBefore = process.memoryUsage();
      await parser.processFile(csvPath, { uploadKey: 'performance-profile' });
      const memAfter = process.memoryUsage();

      const heapDelta = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;

      console.log(`\n💾 Memory Usage (5,000 rows):`);
      console.log(`   Heap Delta: ${heapDelta.toFixed(2)} MB`);
      console.log(`   Heap Used: ${(memAfter.heapUsed / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   RSS: ${(memAfter.rss / 1024 / 1024).toFixed(2)} MB`);

      // Memory usage should be reasonable (<100MB delta for 5K rows)
      expect(Math.abs(heapDelta)).toBeLessThan(100);
    }, 30000);
  });
});
