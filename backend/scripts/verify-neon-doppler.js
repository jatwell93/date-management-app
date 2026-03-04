#!/usr/bin/env node

/**
 * Pre-Migration Verification Script with Doppler Support
 */

const { execSync } = require('child_process');

async function main() {
  console.log('🔍 Pre-Migration Verification (using Doppler)\n');
  
  try {
    // Check if Doppler CLI is installed
    execSync('doppler --version', { stdio: 'pipe' });
  } catch (error) {
    console.error('❌ Doppler CLI not found. Please install from https://cli.doppler.com');
    process.exit(1);
  }

  try {
    // Test connection with PostgreSQL provider via Doppler
    console.log('1️⃣  Testing Neon PostgreSQL connection via Doppler...');
    execSync('doppler run -- npx ts-node scripts/test-connection.ts', { stdio: 'inherit' });

    // Check if database is empty
    console.log('\n2️⃣  Checking database state...');
    execSync('doppler run -- npx ts-node scripts/check-tables.ts', { stdio: 'inherit' });

    // Test write permissions
    console.log('\n3️⃣  Testing write permissions...');
    execSync('doppler run -- npx ts-node scripts/test-write-permissions.ts', { stdio: 'inherit' });

    console.log('\n✅ Pre-migration verification passed!');
    console.log('You can now run: npm run migrate:prod');

  } catch (error) {
    console.error('\n❌ Verification failed');
    console.log('Make sure you have access to the Doppler "prd" project');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
