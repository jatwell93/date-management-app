import { PrismaClient } from '@prisma/client';

// Explicitly use Neon connection string
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.NEON_CONNECTION_STRING
    }
  }
});

async function main() {
  try {
    await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS _migration_test (id SERIAL PRIMARY KEY)`;
    await prisma.$executeRaw`DROP TABLE IF EXISTS _migration_test`;
    console.log('✅ Write permissions verified');
    
    await prisma.$disconnect();
  } catch (error) {
    console.error('❌ Write permissions test failed:', error);
    process.exit(1);
  }
}

main();
