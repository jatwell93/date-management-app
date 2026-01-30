#!/usr/bin/env node
/**
 * Memory Usage Verification Script for CSV Parser
 *
 * This script tests that the streaming CSV parser maintains constant memory usage
 * when processing large files. Run with:
 *
 *   npx ts-node scripts/verify-csv-memory.ts
 *
 * Or with garbage collection logging:
 *
 *   node --expose-gc -r ts-node/register scripts/verify-csv-memory.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Import the CSV parser (without database operations for memory testing)
import { parse } from 'csv-parse';

interface MemorySnapshot {
  timestamp: number;
  rowsProcessed: number;
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
}

async function generateTestCSV(lineCount: number): Promise<string> {
  const filePath = path.join(os.tmpdir(), `memory-test-${lineCount}.csv`);

  console.log(`Generating ${lineCount.toLocaleString()} line CSV file...`);
  const startTime = Date.now();

  const stream = fs.createWriteStream(filePath);
  stream.write('SKU,Name,Barcode,Cost\n');

  for (let i = 1; i <= lineCount; i++) {
    const sku = `SKU${String(i).padStart(6, '0')}`;
    const name = `Test Product ${i} with some additional description text for realistic sizing`;
    const barcode = String(100000000000 + i);
    const cost = (Math.random() * 100).toFixed(2);
    stream.write(`${sku},${name},${barcode},${cost}\n`);

    if (i % 100000 === 0) {
      console.log(`  Generated ${i.toLocaleString()} rows...`);
    }
  }

  return new Promise((resolve, reject) => {
    stream.on('finish', () => {
      const stats = fs.statSync(filePath);
      console.log(
        `Generated ${(stats.size / 1024 / 1024).toFixed(2)} MB file in ${Date.now() - startTime}ms`,
      );
      resolve(filePath);
    });
    stream.on('error', reject);
    stream.end();
  });
}

function getMemorySnapshot(rowsProcessed: number): MemorySnapshot {
  const mem = process.memoryUsage();
  return {
    timestamp: Date.now(),
    rowsProcessed,
    heapUsedMB: mem.heapUsed / 1024 / 1024,
    heapTotalMB: mem.heapTotal / 1024 / 1024,
    rssMB: mem.rss / 1024 / 1024,
  };
}

async function processCSVWithMemoryTracking(
  filePath: string,
  snapshotInterval: number = 1000,
): Promise<MemorySnapshot[]> {
  const snapshots: MemorySnapshot[] = [];
  let rowCount = 0;

  // Force GC if available
  if (global.gc) {
    global.gc();
    console.log('Forced garbage collection before processing');
  }

  // Initial snapshot
  snapshots.push(getMemorySnapshot(0));

  const parser = fs
    .createReadStream(filePath)
    .pipe(parse({ columns: true, skip_empty_lines: true, trim: true }));

  console.log('\nProcessing CSV with streaming parser...');
  const startTime = Date.now();

  for await (const row of parser) {
    rowCount++;

    // Simulate some minimal processing (validation)
    const sku = row.SKU || row.sku || '';
    const name = row.Name || row.name || '';
    const barcode = row.Barcode || row.barcode || '';
    const cost = parseFloat(row.Cost || row.cost || '0');

    void sku;
    void name;
    void barcode;
    void cost;

    // Intentionally don't store the row - streaming parser should not accumulate

    if (rowCount % snapshotInterval === 0) {
      snapshots.push(getMemorySnapshot(rowCount));

      if (rowCount % 10000 === 0) {
        const mem = snapshots[snapshots.length - 1];
        console.log(
          `  Processed ${rowCount.toLocaleString()} rows - Heap: ${mem.heapUsedMB.toFixed(2)} MB, RSS: ${mem.rssMB.toFixed(2)} MB`,
        );
      }
    }
  }

  // Final snapshot
  snapshots.push(getMemorySnapshot(rowCount));

  console.log(`\nCompleted in ${Date.now() - startTime}ms`);
  console.log(`Total rows processed: ${rowCount.toLocaleString()}`);

  return snapshots;
}

function analyzeMemoryGrowth(snapshots: MemorySnapshot[]): void {
  console.log('\n=== Memory Analysis ===\n');

  const startMem = snapshots[0];
  const endMem = snapshots[snapshots.length - 1];

  console.log('Start Memory:');
  console.log(`  Heap Used: ${startMem.heapUsedMB.toFixed(2)} MB`);
  console.log(`  RSS: ${startMem.rssMB.toFixed(2)} MB`);

  console.log('\nEnd Memory:');
  console.log(`  Heap Used: ${endMem.heapUsedMB.toFixed(2)} MB`);
  console.log(`  RSS: ${endMem.rssMB.toFixed(2)} MB`);

  const heapGrowth = endMem.heapUsedMB - startMem.heapUsedMB;
  const rssGrowth = endMem.rssMB - startMem.rssMB;

  console.log('\nMemory Growth:');
  console.log(`  Heap: ${heapGrowth > 0 ? '+' : ''}${heapGrowth.toFixed(2)} MB`);
  console.log(`  RSS: ${rssGrowth > 0 ? '+' : ''}${rssGrowth.toFixed(2)} MB`);

  // Analyze growth pattern
  const heapValues = snapshots.map((s) => s.heapUsedMB);
  const minHeap = Math.min(...heapValues);
  const maxHeap = Math.max(...heapValues);
  const avgHeap = heapValues.reduce((a, b) => a + b, 0) / heapValues.length;

  console.log('\nHeap Statistics:');
  console.log(`  Min: ${minHeap.toFixed(2)} MB`);
  console.log(`  Max: ${maxHeap.toFixed(2)} MB`);
  console.log(`  Avg: ${avgHeap.toFixed(2)} MB`);
  console.log(`  Range: ${(maxHeap - minHeap).toFixed(2)} MB`);

  // Check for linear growth (indicates a memory leak)
  const firstThird = snapshots.slice(0, Math.floor(snapshots.length / 3));
  const lastThird = snapshots.slice(-Math.floor(snapshots.length / 3));

  const avgFirstThird = firstThird.reduce((a, s) => a + s.heapUsedMB, 0) / firstThird.length;
  const avgLastThird = lastThird.reduce((a, s) => a + s.heapUsedMB, 0) / lastThird.length;

  const growthRatio = avgLastThird / avgFirstThird;

  console.log('\nGrowth Pattern Analysis:');
  console.log(`  Avg first third: ${avgFirstThird.toFixed(2)} MB`);
  console.log(`  Avg last third: ${avgLastThird.toFixed(2)} MB`);
  console.log(`  Growth ratio: ${growthRatio.toFixed(2)}x`);

  // Verdict
  console.log('\n=== VERDICT ===');
  if (growthRatio < 1.5 && heapGrowth < 50) {
    console.log('✅ PASS: Memory usage is constant (streaming works correctly)');
  } else if (growthRatio < 2.0 && heapGrowth < 100) {
    console.log('⚠️ WARNING: Memory growth is acceptable but higher than expected');
    console.log('   This may be due to GC timing or test environment factors');
  } else {
    console.log('❌ FAIL: Memory growth indicates potential memory leak');
    console.log('   Review the streaming implementation for accumulated data');
  }
}

async function main() {
  console.log('=== CSV Parser Memory Verification ===\n');
  console.log('This test verifies that the streaming CSV parser maintains');
  console.log('constant memory usage regardless of file size.\n');

  const lineCount = parseInt(process.argv[2] || '10000', 10);
  console.log(`Testing with ${lineCount.toLocaleString()} rows\n`);

  try {
    // Generate test file
    const filePath = await generateTestCSV(lineCount);

    // Process with memory tracking
    const snapshots = await processCSVWithMemoryTracking(filePath);

    // Analyze results
    analyzeMemoryGrowth(snapshots);

    // Clean up
    fs.unlinkSync(filePath);
    console.log('\nTest file cleaned up.');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
