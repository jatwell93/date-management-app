const { execSync } = require('child_process');
const path = require('path');

module.exports = async () => {
  // Load environment variables from .env file
  require('dotenv').config();

  // Verify Neon connection string is available
  if (!process.env.NEON_CONNECTION_STRING && !process.env.DATABASE_URL) {
    console.warn('⚠️  NEON_CONNECTION_STRING or DATABASE_URL not set in .env');
    console.warn('   Production tests will be skipped.');
    process.env.SKIP_NEON_TESTS = 'true';
    return;
  }

  process.env.DATABASE_URL = process.env.NEON_CONNECTION_STRING || process.env.DATABASE_URL;
  process.env.NODE_ENV = 'production';
  process.env.DATABASE_DRIVER = 'postgresql';

  console.log('\nSetting up Neon test database...');
  try {
    // Copy production schema to default location for Prisma
    const fs = require('fs');
    const prodSchema = path.join(__dirname, 'prisma', 'production', 'schema.prisma');
    const defaultSchema = path.join(__dirname, 'prisma', 'schema.prisma');

    // Keep backup of original SQLite schema
    if (!fs.existsSync(defaultSchema + '.sqlite.bak')) {
      fs.copyFileSync(defaultSchema, defaultSchema + '.sqlite.bak');
      console.log('✓ Backed up SQLite schema');
    }

    // Copy PostgreSQL schema into place
    fs.copyFileSync(prodSchema, defaultSchema);
    console.log('✓ Loaded PostgreSQL schema for Neon tests');

    // Apply migrations to Neon
    execSync('npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss', {
      stdio: 'pipe', // Capture output
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: process.env.NEON_CONNECTION_STRING },
    });
    console.log('✓ Neon test database migrated successfully.');
  } catch (error) {
    console.warn('⚠️  Failed to migrate Neon test database:');
    console.warn('   ' + error.message.split('\n')[0]);
    console.warn('   Ensure NEON_CONNECTION_STRING is valid and network is accessible.');
    // Don't fail - allow tests to run in development mode
    process.env.SKIP_NEON_TESTS = 'true';
  }
};
