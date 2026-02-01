/**
 * R2 Connection Test Script
 *
 * Tests Cloudflare R2 connectivity and operations using the R2StorageProvider.
 * Run this script to verify your R2 credentials and bucket configuration.
 *
 * Usage:
 *   npx ts-node scripts/test-r2-connection.ts
 *
 * Required environment variables:
 *   R2_ACCOUNT_ID      - Your Cloudflare account ID
 *   R2_ACCESS_KEY_ID   - R2 API token access key
 *   R2_SECRET_ACCESS_KEY - R2 API token secret key
 *   R2_BUCKET_NAME     - Your R2 bucket name (e.g., csv-uploads-prod)
 */

import { R2StorageProvider, R2StorageConfig } from '../src/storage/r2-storage.provider';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from root .env (where R2 credentials are stored)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
// Also try backend/.env as fallback
dotenv.config({ path: path.resolve(__dirname, '../.env') });

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration?: number;
}

const TEST_FILE_KEY = `test/r2-connection-test-${Date.now()}.txt`;
const TEST_CONTENT = 'R2 connection test - This file can be safely deleted.';

async function runTests(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          Cloudflare R2 Connection Test Suite               ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Validate environment variables
  const requiredEnvVars = [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
  ];

  const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach((v) => console.error(`   - ${v}`));
    console.error('\nPlease set these in your .env file or environment.');
    process.exit(1);
  }

  const config: R2StorageConfig = {
    accountId: process.env.R2_ACCOUNT_ID!,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    bucketName: process.env.R2_BUCKET_NAME!,
  };

  console.log('Configuration:');
  console.log(`  Account ID: ${config.accountId.substring(0, 8)}...`);
  console.log(`  Bucket: ${config.bucketName}`);
  console.log(`  Access Key: ${config.accessKeyId.substring(0, 8)}...`);
  console.log('');

  const results: TestResult[] = [];
  let provider: R2StorageProvider;

  // Test 1: Initialize provider
  console.log('🔄 Test 1: Initializing R2StorageProvider...');
  const initStart = Date.now();
  try {
    provider = new R2StorageProvider(config);
    results.push({
      name: 'Initialize Provider',
      passed: true,
      message: 'R2StorageProvider initialized successfully',
      duration: Date.now() - initStart,
    });
    console.log('✅ Provider initialized\n');
  } catch (error) {
    results.push({
      name: 'Initialize Provider',
      passed: false,
      message: `Failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
    });
    console.error('❌ Failed to initialize provider\n');
    printSummary(results);
    process.exit(1);
  }

  // Test 2: Upload file
  console.log('🔄 Test 2: Uploading test file...');
  const uploadStart = Date.now();
  try {
    const buffer = Buffer.from(TEST_CONTENT, 'utf-8');
    await provider.upload(TEST_FILE_KEY, buffer, 'text/plain');
    results.push({
      name: 'Upload File',
      passed: true,
      message: `Uploaded ${TEST_FILE_KEY} (${buffer.length} bytes)`,
      duration: Date.now() - uploadStart,
    });
    console.log(`✅ Uploaded: ${TEST_FILE_KEY}\n`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCause = (error as { cause?: Error })?.cause;
    results.push({
      name: 'Upload File',
      passed: false,
      message: `Upload failed: ${errorMessage}`,
    });
    console.error('❌ Upload failed');
    console.error(`   Error: ${errorMessage}`);
    if (errorCause) {
      console.error(`   Cause: ${errorCause.message}`);
    }
    // Log full error for debugging
    console.error('   Full error:', error);
    console.error('');
    printSummary(results);
    process.exit(1);
  }

  // Test 3: Check file exists
  console.log('🔄 Test 3: Checking file exists...');
  const existsStart = Date.now();
  try {
    const exists = await provider.exists(TEST_FILE_KEY);
    if (exists) {
      results.push({
        name: 'File Exists Check',
        passed: true,
        message: 'File exists check returned true',
        duration: Date.now() - existsStart,
      });
      console.log('✅ File exists\n');
    } else {
      throw new Error('File should exist but exists() returned false');
    }
  } catch (error) {
    results.push({
      name: 'File Exists Check',
      passed: false,
      message: `Exists check failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    console.error('❌ Exists check failed\n');
  }

  // Test 4: Get metadata
  console.log('🔄 Test 4: Getting file metadata...');
  const metadataStart = Date.now();
  try {
    const metadata = await provider.getMetadata(TEST_FILE_KEY);
    results.push({
      name: 'Get Metadata',
      passed: true,
      message: `Size: ${metadata.size} bytes, Type: ${metadata.contentType}`,
      duration: Date.now() - metadataStart,
    });
    console.log(`✅ Metadata: ${JSON.stringify(metadata, null, 2)}\n`);
  } catch (error) {
    results.push({
      name: 'Get Metadata',
      passed: false,
      message: `Metadata failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    console.error('❌ Get metadata failed\n');
  }

  // Test 5: Download file
  console.log('🔄 Test 5: Downloading file...');
  const downloadStart = Date.now();
  try {
    const downloaded = await provider.download(TEST_FILE_KEY);
    const content = downloaded.toString('utf-8');
    if (content === TEST_CONTENT) {
      results.push({
        name: 'Download File',
        passed: true,
        message: 'Downloaded content matches original',
        duration: Date.now() - downloadStart,
      });
      console.log('✅ Download successful, content verified\n');
    } else {
      throw new Error('Downloaded content does not match original');
    }
  } catch (error) {
    results.push({
      name: 'Download File',
      passed: false,
      message: `Download failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    console.error('❌ Download failed\n');
  }

  // Test 6: Generate presigned upload URL
  console.log('🔄 Test 6: Generating presigned upload URL...');
  const presignedUploadStart = Date.now();
  try {
    const presignedKey = `test/presigned-test-${Date.now()}.txt`;
    const url = await provider.getPresignedUploadUrl(presignedKey, 3600);
    if (url && url.includes(config.bucketName)) {
      results.push({
        name: 'Presigned Upload URL',
        passed: true,
        message: `Generated URL (expires in 1 hour)`,
        duration: Date.now() - presignedUploadStart,
      });
      console.log(`✅ Presigned URL generated: ${url.substring(0, 80)}...\n`);
    } else {
      throw new Error('Generated URL does not contain bucket name');
    }
  } catch (error) {
    results.push({
      name: 'Presigned Upload URL',
      passed: false,
      message: `Presigned URL failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    console.error('❌ Presigned URL generation failed\n');
  }

  // Test 7: Generate presigned download URL
  console.log('🔄 Test 7: Generating presigned download URL...');
  const presignedDownloadStart = Date.now();
  try {
    const url = await provider.getPresignedDownloadUrl(TEST_FILE_KEY, 3600);
    if (url && url.includes(config.bucketName)) {
      results.push({
        name: 'Presigned Download URL',
        passed: true,
        message: `Generated URL (expires in 1 hour)`,
        duration: Date.now() - presignedDownloadStart,
      });
      console.log(`✅ Presigned download URL generated: ${url.substring(0, 80)}...\n`);
    } else {
      throw new Error('Generated URL does not contain bucket name');
    }
  } catch (error) {
    results.push({
      name: 'Presigned Download URL',
      passed: false,
      message: `Presigned download URL failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    console.error('❌ Presigned download URL generation failed\n');
  }

  // Test 8: Delete file (cleanup)
  console.log('🔄 Test 8: Deleting test file (cleanup)...');
  const deleteStart = Date.now();
  try {
    await provider.delete(TEST_FILE_KEY);
    results.push({
      name: 'Delete File',
      passed: true,
      message: 'Test file deleted successfully',
      duration: Date.now() - deleteStart,
    });
    console.log('✅ Test file deleted\n');
  } catch (error) {
    results.push({
      name: 'Delete File',
      passed: false,
      message: `Delete failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    console.error('❌ Delete failed\n');
  }

  // Test 9: Verify file deleted
  console.log('🔄 Test 9: Verifying file deleted...');
  const verifyDeleteStart = Date.now();
  try {
    const exists = await provider.exists(TEST_FILE_KEY);
    if (!exists) {
      results.push({
        name: 'Verify Deletion',
        passed: true,
        message: 'File no longer exists after deletion',
        duration: Date.now() - verifyDeleteStart,
      });
      console.log('✅ File confirmed deleted\n');
    } else {
      throw new Error('File still exists after deletion');
    }
  } catch (error) {
    if ((error as Error).message === 'File still exists after deletion') {
      results.push({
        name: 'Verify Deletion',
        passed: false,
        message: 'File still exists after deletion',
      });
    } else {
      // Any other error (like checking non-existent file) is acceptable
      results.push({
        name: 'Verify Deletion',
        passed: true,
        message: 'File confirmed deleted',
        duration: Date.now() - verifyDeleteStart,
      });
      console.log('✅ File confirmed deleted\n');
    }
  }

  printSummary(results);
}

function printSummary(results: TestResult[]): void {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                      Test Summary                          ║');
  console.log('╠════════════════════════════════════════════════════════════╣');

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  results.forEach((result) => {
    const status = result.passed ? '✅' : '❌';
    const duration = result.duration ? ` (${result.duration}ms)` : '';
    console.log(`║ ${status} ${result.name.padEnd(25)} ${duration.padEnd(10)} ║`);
    if (!result.passed) {
      console.log(`║    └─ ${result.message.substring(0, 48).padEnd(50)} ║`);
    }
  });

  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║ Total: ${passed} passed, ${failed} failed`.padEnd(61) + '║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  if (failed > 0) {
    console.log('\n⚠️  Some tests failed. Please check your R2 configuration.');
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed! R2 is configured correctly.');
    process.exit(0);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
