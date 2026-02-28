const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const DEFAULT_ORG_ID = '248c0a81-db22-4e41-869d-61634de4a304';

async function main() {
  console.log('🔧 Backfilling NULL organizationId values...\n');

  // Get all tables that need backfilling
  const tables = [
    { name: 'storeArea', model: p.storeArea },
    { name: 'user', model: p.user },
    { name: 'product', model: p.product },
    { name: 'inventoryItem', model: p.inventoryItem },
    { name: 'itemTransaction', model: p.itemTransaction },
    { name: 'expiredItemTransaction', model: p.expiredItemTransaction },
    { name: 'auditLog', model: p.auditLog },
    { name: 'upload', model: p.upload },
  ];

  // Ensure default organization exists
  try {
    await p.organization.upsert({
      where: { id: DEFAULT_ORG_ID },
      update: {},
      create: {
        id: DEFAULT_ORG_ID,
        name: 'Default Organization',
        slug: 'default-org',
        contactEmail: 'default@example.com',
      },
    });
    console.log('✅ Default organization ensured');
  } catch (e) {
    console.log('ℹ️ Default organization already exists');
  }

  // Backfill each table
  for (const table of tables) {
    const count = await table.model.updateMany({
      where: { organizationId: null },
      data: { organizationId: DEFAULT_ORG_ID },
    });

    if (count.count > 0) {
      console.log(`✅ Updated ${count.count} ${table.name}(s)`);
    }
  }

  // Verify no NULL values remain
  console.log('\n🔍 Verifying no NULL values remain...');
  let hasNulls = false;

  for (const table of tables) {
    const nullCount = await table.model.count({
      where: { organizationId: null },
    });

    if (nullCount > 0) {
      console.log(`❌ ${table.name} still has ${nullCount} NULL organizationId values`);
      hasNulls = true;
    }
  }

  if (!hasNulls) {
    console.log('✅ All tables have non-NULL organizationId values');
  }

  console.log('\n✅ Backfill complete!');
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
