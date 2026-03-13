#!/usr/bin/env node

/**
 * Production Database Migration Script
 *
 * Simple script to migrate to Neon PostgreSQL
 */

const { execSync } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
  console.log('🚀 Production Database Migration to Neon PostgreSQL\n');

  // Check environment
  if (!process.env.NEON_CONNECTION_STRING) {
    console.error('❌ NEON_CONNECTION_STRING environment variable is not set');
    console.log('\nPlease set it in your .env file:');
    console.log('NEON_CONNECTION_STRING=postgresql://user:password@host/database?sslmode=require');
    process.exit(1);
  }

  console.log('📋 Migration Plan:');
  console.log('1. Verify Neon connection');
  console.log('2. Generate Prisma client for PostgreSQL');
  console.log('3. Push schema to Neon database');
  console.log('4. Seed tier feature flags');
  console.log('5. Verify migration success\n');

  // Confirm before proceeding
  const answer = await question(
    '⚠️  This will modify the production database. Continue? (yes/no): ',
  );
  if (answer.toLowerCase() !== 'yes') {
    console.log('❌ Migration cancelled');
    process.exit(0);
  }

  try {
    // Step 1: Verify connection
    console.log('1️⃣  Verifying Neon connection...');
    execSync('npm run verify:neon', { stdio: 'inherit' });
    console.log('✅ Connection verified');

    // Step 2: Generate Prisma client
    console.log('\n2️⃣  Generating Prisma client for PostgreSQL...');
    execSync('npx prisma generate --schema=./prisma/production/schema.prisma', {
      stdio: 'inherit',
    });
    console.log('✅ Prisma client generated');

    // Step 3: Push schema
    console.log('\n3️⃣  Pushing schema to Neon database...');
    execSync('npx prisma db push --schema=./prisma/production/schema.prisma', { stdio: 'inherit' });
    console.log('✅ Schema pushed successfully');

    // Step 4: Seed tier flags
    console.log('\n4️⃣  Seeding tier feature flags...');
    execSync(
      'npx ts-node -e "import { PrismaClient } from "@prisma/client"; const prisma = new PrismaClient(); (async () => { const flags = [ { tierLevel: "starter", featureKey: "max_skus", enabled: true, limitValue: 500 }, { tierLevel: "starter", featureKey: "max_users", enabled: true, limitValue: 1 }, { tierLevel: "starter", featureKey: "max_inventory_items", enabled: true, limitValue: 5000 }, { tierLevel: "starter", featureKey: "storage_bytes", enabled: true, limitValue: 1073741824 }, { tierLevel: "starter", featureKey: "advanced_analytics", enabled: false }, { tierLevel: "professional", featureKey: "max_skus", enabled: true, limitValue: 2000 }, { tierLevel: "professional", featureKey: "max_users", enabled: true, limitValue: 3 }, { tierLevel: "professional", featureKey: "max_inventory_items", enabled: true, limitValue: 20000 }, { tierLevel: "professional", featureKey: "storage_bytes", enabled: true, limitValue: 10737418240 }, { tierLevel: "professional", featureKey: "advanced_analytics", enabled: true }, { tierLevel: "premium", featureKey: "max_skus", enabled: true, limitValue: null }, { tierLevel: "premium", featureKey: "max_users", enabled: true, limitValue: 10 }, { tierLevel: "premium", featureKey: "max_inventory_items", enabled: true, limitValue: null }, { tierLevel: "premium", featureKey: "storage_bytes", enabled: true, limitValue: 107374182400 }, { tierLevel: "premium", featureKey: "advanced_analytics", enabled: true }, { tierLevel: "concierge", featureKey: "max_skus", enabled: true, limitValue: null }, { tierLevel: "concierge", featureKey: "max_users", enabled: true, limitValue: 10 }, { tierLevel: "concierge", featureKey: "max_inventory_items", enabled: true, limitValue: null }, { tierLevel: "concierge", featureKey: "storage_bytes", enabled: true, limitValue: null }, { tierLevel: "concierge", featureKey: "advanced_analytics", enabled: true } ]; for (const flag of flags) { await prisma.tierFeatureFlag.upsert({ where: { tierLevel_featureKey: { tierLevel: flag.tierLevel, featureKey: flag.featureKey } }, update: flag, create: flag }); } console.log("✅ Tier feature flags seeded"); await prisma.$disconnect(); })();"',
      { stdio: 'inherit' },
    );

    // Step 5: Verify
    console.log('\n5️⃣  Verifying migration...');
    execSync(
      'npx ts-node -e "import { PrismaClient } from "@prisma/client"; const prisma = new PrismaClient(); (async () => { const tableCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = "public"`; const flagCount = await prisma.tierFeatureFlag.count(); console.log(`✅ Found ${tableCount[0].count} tables`); console.log(`✅ Found ${flagCount} tier feature flags`); await prisma.$disconnect(); })();"',
      { stdio: 'inherit' },
    );

    console.log('\n🎉 Production database migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Deploy Cloudflare Workers: cd ../workers && npm run deploy:prod');
    console.log('2. Configure production secrets');
    console.log('3. Deploy frontend');
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
