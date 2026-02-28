const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function listMigrations() {
  const migrations = await p.$queryRaw`SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at`;
  
  console.log('Applied migrations:');
  migrations.forEach((m: any) => {
    console.log(`  - ${m.migration_name} (${m.finished_at})`);
  });
  
  await p.$disconnect();
}

listMigrations().catch(console.error);
