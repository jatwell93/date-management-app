const { execSync } = require('child_process');

module.exports = async () => {
  process.env.DATABASE_URL = 'file:./test.db';
  process.env.DATABASE_PATH = './test.db';
  process.env.NODE_ENV = 'test';

  console.log('\nSetting up test database...');
  try {
    // Correct schema path (prisma/schema.prisma is the actual location)
    execSync('npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss', {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    console.log('Test database migrated successfully.');
  } catch (error) {
    console.error('Failed to migrate test database:', error.message);
    throw error; // Fail fast if schema can't sync
  }
};
