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
    const tables = await prisma.$queryRaw<any[]>`
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
    
    await prisma.$disconnect();
  } catch (error) {
    console.error('❌ Failed to check tables:', error);
    process.exit(1);
  }
}

main();
