const { execSync } = require('child_process');

module.exports = async () => {
  process.env.DATABASE_URL = "file:./test.db";
  process.env.NODE_ENV = 'test';
  
  console.log('\nSetting up test database...');
  try {
    execSync('npx prisma db push --schema=./src/prisma/schema.prisma --accept-data-loss', { 
      stdio: 'ignore',
      cwd: process.cwd()
    });
    console.log('Test database migrated.');
  } catch (error) {
    // Try allow fallback if the schema path is different
    try {
        execSync('npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss', { 
            stdio: 'ignore',
            cwd: process.cwd()
          });
          console.log('Test database migrated.'); 
    } catch (e) {
        console.error('Failed to migrate test database:', e.message);
    }
  }
};
