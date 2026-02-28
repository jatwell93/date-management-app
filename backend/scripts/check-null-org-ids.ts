const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function checkNulls() {
  console.log('Checking for NULL organizationId values...\n');

  const tables = [
    { name: 'store_areas', model: p.storeArea },
    { name: 'users', model: p.user },
    { name: 'products', model: p.product },
    { name: 'inventory_items', model: p.inventoryItem },
    { name: 'item_transactions', model: p.itemTransaction },
    { name: 'expired_item_transactions', model: p.expiredItemTransaction },
    { name: 'audit_log', model: p.auditLog },
    { name: 'uploads', model: p.upload },
  ];

  let hasNulls = false;
  
  for (const table of tables) {
    try {
      const nullCount = await table.model.count({
        where: { organizationId: null },
      });
      
      if (nullCount > 0) {
        console.log(`❌ ${table.name} has ${nullCount} NULL organizationId values`);
        hasNulls = true;
      } else {
        console.log(`✅ ${table.name} has no NULL organizationId values`);
      }
    } catch (e) {
      console.log(`⚠️ Could not check ${table.name}: ${(e as Error).message}`);
    }
  }

  if (!hasNulls) {
    console.log('\n✅ All tables have non-NULL organizationId values');
  }

  await p.$disconnect();
}

checkNulls().catch((e) => {
  console.error(e);
  process.exit(1);
});
