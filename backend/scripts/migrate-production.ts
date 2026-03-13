#!/usr/bin/env node

/**
 * Production Database Migration Script
 *
 * This script handles the migration of the Neon PostgreSQL database
 * for production deployment.
 *
 * Usage:
 *   npm run migrate:prod
 *
 * Prerequisites:
 *   - NEON_CONNECTION_STRING must be set in environment
 *   - Neon database must be created and accessible
 */

import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import * as path from 'path';
import { createInterface } from 'readline';
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function question(query: string): Promise<string> {
  return new Promise<string>((resolve) => {
    rl.question(query, resolve);
  });
}

async function main() {
  console.log('🚀 Production Database Migration\n');

  // Check environment
  if (!process.env.NEON_CONNECTION_STRING) {
    console.error('❌ NEON_CONNECTION_STRING environment variable is not set');
    console.log('\nPlease set it with:');
    console.log(
      'export NEON_CONNECTION_STRING="postgresql://user:password@host/database?sslmode=require"',
    );
    process.exit(1);
  }

  console.log('📋 Migration Plan:');
  console.log('1. Test database connection');
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
    // Test connection
    console.log('1️⃣  Testing database connection...');
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.NEON_CONNECTION_STRING,
        },
      },
    });

    await prisma.$connect();
    console.log('✅ Database connection successful');

    // Generate Prisma client
    console.log('\n2️⃣  Generating Prisma client for PostgreSQL...');
    execSync('npx prisma generate --schema=./prisma/production/schema.prisma', {
      stdio: 'inherit',
    });
    console.log('✅ Prisma client generated');

    // Push schema
    console.log('\n3️⃣  Pushing schema to Neon database...');
    execSync('npx prisma db push --schema=./prisma/production/schema.prisma', { stdio: 'inherit' });
    console.log('✅ Schema pushed successfully');

    // Seed tier feature flags
    console.log('\n4️⃣  Seeding tier feature flags...');
    await seedTierFlags(prisma);
    console.log('✅ Tier feature flags seeded');

    // Verify
    console.log('\n5️⃣  Verifying migration...');
    await verifyMigration(prisma);
    console.log('✅ Migration verified successfully');

    await prisma.$disconnect();
    console.log('\n🎉 Production database migration completed successfully!');
  } catch (error: unknown) {
    console.error('\n❌ Migration failed:', (error as Error).message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

async function seedTierFlags(prisma: PrismaClient) {
  const tierFlags = [
    // Starter tier
    { tierLevel: 'starter', featureKey: 'max_skus', enabled: true, limitValue: 500 },
    { tierLevel: 'starter', featureKey: 'max_users', enabled: true, limitValue: 1 },
    { tierLevel: 'starter', featureKey: 'max_inventory_items', enabled: true, limitValue: 5000 },
    { tierLevel: 'starter', featureKey: 'storage_bytes', enabled: true, limitValue: 1073741824 },
    { tierLevel: 'starter', featureKey: 'advanced_analytics', enabled: false },

    // Professional tier
    { tierLevel: 'professional', featureKey: 'max_skus', enabled: true, limitValue: 2000 },
    { tierLevel: 'professional', featureKey: 'max_users', enabled: true, limitValue: 3 },
    {
      tierLevel: 'professional',
      featureKey: 'max_inventory_items',
      enabled: true,
      limitValue: 20000,
    },
    {
      tierLevel: 'professional',
      featureKey: 'storage_bytes',
      enabled: true,
      limitValue: 10737418240,
    },
    { tierLevel: 'professional', featureKey: 'advanced_analytics', enabled: true },

    // Premium tier
    { tierLevel: 'premium', featureKey: 'max_skus', enabled: true, limitValue: null },
    { tierLevel: 'premium', featureKey: 'max_users', enabled: true, limitValue: 10 },
    { tierLevel: 'premium', featureKey: 'max_inventory_items', enabled: true, limitValue: null },
    { tierLevel: 'premium', featureKey: 'storage_bytes', enabled: true, limitValue: 107374182400 },
    { tierLevel: 'premium', featureKey: 'advanced_analytics', enabled: true },

    // Concierge tier
    { tierLevel: 'concierge', featureKey: 'max_skus', enabled: true, limitValue: null },
    { tierLevel: 'concierge', featureKey: 'max_users', enabled: true, limitValue: 10 },
    { tierLevel: 'concierge', featureKey: 'max_inventory_items', enabled: true, limitValue: null },
    { tierLevel: 'concierge', featureKey: 'storage_bytes', enabled: true, limitValue: null },
    { tierLevel: 'concierge', featureKey: 'advanced_analytics', enabled: true },
  ];

  for (const flag of tierFlags) {
    await prisma.tierFeatureFlag.upsert({
      where: {
        tierLevel_featureKey: {
          tierLevel: flag.tierLevel,
          featureKey: flag.featureKey,
        },
      },
      update: flag,
      create: flag,
    });
  }
}

async function verifyMigration(prisma: PrismaClient) {
  // Check all tables exist
  const tables = [
    'organizations',
    'subscription_tiers',
    'trial_events',
    'tier_feature_flags',
    'organization_usage',
    'users',
    'products',
    'inventory_items',
    'store_areas',
    'uploads',
    'audit_logs',
    'item_transactions',
    'expired_item_transactions',
    'organization_invites',
    'processed_webhook_events',
  ];

  for (const table of tables) {
    try {
      const result = await prisma.$queryRaw<{ exists: number }[]>`SELECT 1 AS "exists"
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ${table}
        LIMIT 1`;
      if (result.length === 0) {
        throw new Error(`Table ${table} not found or not accessible`);
      }
    } catch (error) {
      throw new Error(`Table ${table} not found or not accessible`);
    }
  }

  // Check tier flags
  const flagCount = await prisma.tierFeatureFlag.count();
  if (flagCount !== 20) {
    throw new Error(`Expected 20 tier flags, found ${flagCount}`);
  }

  console.log(`  ✓ All ${tables.length} tables verified`);
  console.log(`  ✓ All ${flagCount} tier feature flags verified`);
}

if (require.main === module) {
  main();
}

module.exports = { main };
