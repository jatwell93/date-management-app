const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const DEFAULT_ORG_ID = '248c0a81-db22-4e41-869d-61634de4a304';

async function main() {
  console.log('🔧 Backfilling NULL organizationId values...\n');

  // Backfill storeArea
  const storeAreasUpdated = await p.storeArea.updateMany({
    where: { organizationId: null },
    data: { organizationId: DEFAULT_ORG_ID },
  });
  console.log(`✅ Updated ${storeAreasUpdated.count} storeArea(s)`);

  // Backfill user
  const usersUpdated = await p.user.updateMany({
    where: { organizationId: null },
    data: { organizationId: DEFAULT_ORG_ID },
  });
  console.log(`✅ Updated ${usersUpdated.count} user(s)`);

  console.log('\n✅ Backfill complete!');
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
