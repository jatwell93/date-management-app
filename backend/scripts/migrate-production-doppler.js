#!/usr/bin/env node

/**
 * Production Database Migration Script with Doppler Support
 *
 * This script pulls secrets from Doppler and migrates to Neon PostgreSQL
 */

const { execSync } = require('child_process');
const readline = require('readline');
const fs = require('fs');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
  console.log('🚀 Production Database Migration to Neon PostgreSQL\n');
  console.log('📋 Using Doppler for secrets management\n');

  // Check dependencies
  console.log('🔍 Checking dependencies...');
  try {
    // Check if required commands are available
    execSync('node --version', { stdio: 'pipe' });
    execSync('npx --version', { stdio: 'pipe' });
    console.log('✅ Node.js and npm available');
  } catch (error) {
    console.error('❌ Node.js or npm not available');
    process.exit(1);
  }

  try {
    // Check if Prisma CLI is available
    execSync('npx prisma --version', { stdio: 'pipe' });
    console.log('✅ Prisma CLI available');
  } catch (error) {
    console.error('❌ Prisma CLI not found. Please install: npm install prisma@latest');
    process.exit(1);
  }

  try {
    // Check if ts-node is available (used by some scripts)
    execSync('npx ts-node --version', { stdio: 'pipe' });
    console.log('✅ ts-node available');
  } catch (error) {
    console.warn(
      '⚠️  ts-node not found, some scripts may fail. Install with: npm install -g ts-node',
    );
  }

  try {
    // Check if Doppler CLI is installed
    console.log('🔍 Checking Doppler CLI...');
    execSync('doppler --version', { stdio: 'pipe' });
    console.log('✅ Doppler CLI found');
  } catch (error) {
    console.error('❌ Doppler CLI not found');
    console.log('\nPlease install Doppler CLI:');
    console.log('  # On Windows (PowerShell as Admin)');
    console.log('  iwr -useb https://cli.doppler.com/install.ps1 | iex');
    console.log('\n  # Or download from https://cli.doppler.com');
    process.exit(1);
  }

  // Verify Doppler is configured
  try {
    console.log('\n🔐 Verifying Doppler configuration...');
    const config = execSync('doppler configure get config --plain', { encoding: 'utf8' }).trim();
    if (!config) {
      throw new Error('No Doppler configuration found');
    }
    console.log(`✅ Using config: ${config}`);
  } catch (error) {
    console.error('❌ Doppler not configured');
    console.log('\nPlease run: doppler setup');
    process.exit(1);
  }

  // Test connection to Doppler secrets
  try {
    console.log('\n🔍 Testing access to secrets...');
    const secrets = execSync('doppler secrets download --no-file --format=json', {
      encoding: 'utf8',
    });
    const parsed = JSON.parse(secrets);
    if (!parsed.NEON_CONNECTION_STRING) {
      throw new Error('NEON_CONNECTION_STRING not found in Doppler secrets');
    }
    console.log('✅ NEON_CONNECTION_STRING found in Doppler');
  } catch (error) {
    console.error('❌ Failed to access secrets:', error.message);
    console.log('\nMake sure you have access to the "prd" project and config');
    process.exit(1);
  }

  console.log('\n📋 Migration Plan:');
  console.log('1. Pull secrets from Doppler');
  console.log('2. Verify Neon connection');
  console.log('3. Generate Prisma client for PostgreSQL');
  console.log('4. Push schema to Neon database');
  console.log('5. Seed tier feature flags');
  console.log('6. Verify migration success\n');

  // Confirm before proceeding
  const answer = await question(
    '⚠️  This will modify the production database. Continue? (yes/no): ',
  );
  if (answer.toLowerCase() !== 'yes') {
    console.log('❌ Migration cancelled');
    process.exit(0);
  }

  let originalSchema;

  try {
    // Step 1: Update schema to use PostgreSQL
    console.log('\n1️⃣  Updating Prisma schema for PostgreSQL...');
    const fs = require('fs');
    const schemaPath = './prisma/schema.prisma';
    originalSchema = fs.readFileSync(schemaPath, 'utf8');

    // Temporarily update provider to postgresql
    let schema = originalSchema;
    schema = schema.replace('provider = "sqlite"', 'provider = "postgresql"');
    // Add URL line for PostgreSQL migration
    if (!schema.includes('url')) {
      schema = schema.replace('}', '  url      = env("NEON_CONNECTION_STRING")\n}');
    } else {
      schema = schema.replace(
        /url\s*=\s*env\("([^"]+)"\)/,
        'url      = env("NEON_CONNECTION_STRING")',
      );
    }
    fs.writeFileSync(schemaPath, schema);
    console.log('✅ Schema updated to PostgreSQL');

    // Immediately regenerate Prisma client with new schema
    console.log('\n2️⃣  Generating Prisma client for PostgreSQL...');
    execSync('doppler run -- npx prisma generate', { stdio: 'inherit' });
    console.log('✅ Prisma client generated');

    // Step 3: Verify connection
    console.log('\n3️⃣  Verifying Neon connection...');
    execSync('doppler run -- node scripts/verify-neon-doppler.js', { stdio: 'inherit' });
    console.log('✅ Connection verified');

    // Step 4: Push schema
    console.log('\n4️⃣  Pushing schema to Neon database...');
    execSync('doppler run -- npx prisma db push', { stdio: 'inherit' });
    console.log('✅ Schema pushed successfully');

    // Step 5: Seed tier flags
    console.log('\n5️⃣  Seeding tier feature flags...');
    execSync('doppler run -- node scripts/seed-tier-flags.js', { stdio: 'inherit' });
    console.log('✅ Tier feature flags seeded');

    // Step 6: Verify
    console.log('\n6️⃣  Verifying migration...');
    execSync('doppler run -- node scripts/verify-migration.js', { stdio: 'inherit' });

    console.log('\n🎉 Production database migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Deploy Cloudflare Workers: cd ../workers && npm run deploy:prod');
    console.log('2. Configure production secrets in Workers (also via Doppler)');
    console.log('3. Deploy frontend');
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  } finally {
    // Always restore original schema, even on error
    if (originalSchema) {
      try {
        const fs = require('fs');
        const schemaPath = './prisma/schema.prisma';
        fs.writeFileSync(schemaPath, originalSchema);
        console.log('\n✅ Schema restored to SQLite for local development');

        // Regenerate client for SQLite
        console.log('Regenerating Prisma client for SQLite...');
        execSync('npx prisma generate', { stdio: 'inherit' });
      } catch (restoreError) {
        console.error('\n❌ CRITICAL: Failed to restore schema:', restoreError.message);
        console.error(
          'Manual restoration required. The schema file may be in an inconsistent state.',
        );
      }
    }

    rl.close();
  }
}

main();
