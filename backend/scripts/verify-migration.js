const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  try {
    // Count tables
    const tableCount =
      await prisma.$queryRaw`SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public'`;
    console.log(`✅ Found ${tableCount[0].count} tables`);

    // Count tier flags
    const flagCount = await prisma.tierFeatureFlag.count();
    console.log(`✅ Found ${flagCount} tier feature flags`);

    // List table names
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;

    console.log('\n📊 Tables created:');
    tables.forEach((table) => console.log(`   - ${table.table_name}`));

    console.log('\n✅ Migration verification completed successfully!');
  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
