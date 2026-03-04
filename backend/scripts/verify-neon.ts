#!/usr/bin/env node

/**
 * Pre-Migration Verification Script
 * 
 * This script verifies that the Neon database is ready for migration
 * before running the production migration.
 */

const { PrismaClient } = require('@prisma/client');

async function main() {
  console.log('🔍 Pre-Migration Verification\n');
  
  // Check environment
  if (!process.env.NEON_CONNECTION_STRING) {
    console.error('❌ NEON_CONNECTION_STRING environment variable is not set');
    console.log('\nPlease set it with:');
    console.log('export NEON_CONNECTION_STRING="postgresql://user:password@host/database?sslmode=require"');
    process.exit(1);
  }

  try {
    // Test connection with PostgreSQL provider
    console.log('1️⃣  Testing Neon PostgreSQL connection...');
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.NEON_CONNECTION_STRING
        }
      }
    });

    await prisma.$connect();
    console.log('✅ Connection successful');

    // Check PostgreSQL version
    const version = await prisma.$queryRaw`SELECT version()`;
    console.log(`📊 PostgreSQL version: ${version[0].version}`);

    // Check if database is empty
    console.log('\n2️⃣  Checking database state...');
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
    
    if (tables.length === 0) {
      console.log('✅ Database is empty - ready for fresh migration');
    } else {
      console.log(`⚠️  Database has ${tables.length} existing tables:`);
      tables.forEach((table: any) => console.log(`   - ${table.table_name}`));
      
      console.log('\n⚠️  WARNING: This migration will modify existing tables!');
      console.log('   Ensure you have a backup before proceeding.');
    }

    // Test write permissions
    console.log('\n3️⃣  Testing write permissions...');
    await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS _migration_test (id SERIAL PRIMARY KEY)`;
    await prisma.$executeRaw`DROP TABLE IF EXISTS _migration_test`;
    console.log('✅ Write permissions verified');

    await prisma.$disconnect();
    console.log('\n✅ Pre-migration verification passed!');
    console.log('You can now run: npm run migrate:prod');

  } catch (error: any) {
    console.error('\n❌ Verification failed:', error.message);
    
    if (error?.code === 'ECONNREFUSED') {
      console.log('\nTroubleshooting:');
      console.log('- Check if NEON_CONNECTION_STRING is correct');
      console.log('- Ensure Neon database is running');
      console.log('- Verify network connectivity');
    }
    
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
