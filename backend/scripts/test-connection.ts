import { PrismaClient } from '@prisma/client';

// Explicitly use Neon connection string
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.NEON_CONNECTION_STRING,
    },
  },
});

async function main() {
  try {
    await prisma.$connect();
    console.log('✅ Connection successful');

    // Test a simple query that works on PostgreSQL
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log('✅ Database query test passed');

    // Try to get PostgreSQL version
    try {
      const version = await prisma.$queryRaw<any[]>`SELECT version() as version`;
      console.log(`📊 PostgreSQL version: ${version[0].version}`);
    } catch {
      console.log('📊 Could not retrieve version');
    }

    await prisma.$disconnect();
  } catch (error) {
    console.error('❌ Connection failed:', error);
    process.exit(1);
  }
}

main();
