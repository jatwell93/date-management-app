const { execSync } = require('child_process');

module.exports = async () => {
  const testDatabasePath = process.env.TEST_DATABASE_PATH || './test.db';

  process.env.TEST_DATABASE_PATH = testDatabasePath;
  process.env.DATABASE_URL = `file:${testDatabasePath}`;
  process.env.DATABASE_PATH = testDatabasePath;
  process.env.NODE_ENV = 'test';

  console.log('\nSetting up test database...');
  try {
    // Correct schema path (prisma/schema.prisma is the actual location)
    execSync(
      'npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss --skip-generate',
      {
        stdio: 'inherit',
        cwd: process.cwd(),
      },
    );
    console.log('Test database migrated successfully.');
  } catch (error) {
    console.error('Failed to migrate test database:', error.message);
    throw error; // Fail fast if schema can't sync
  }
};
