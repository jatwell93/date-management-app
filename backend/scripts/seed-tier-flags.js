const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  try {
    const tierFlags = [
      // Starter tier
      { tierLevel: 'starter', featureKey: 'max_skus', enabled: true, limitValue: 500 },
      { tierLevel: 'starter', featureKey: 'max_users', enabled: true, limitValue: 1 },
      { tierLevel: 'starter', featureKey: 'max_inventory_items', enabled: true, limitValue: 5000 },
      { tierLevel: 'starter', featureKey: 'storage_bytes', enabled: true, limitValue: 1073741824 },
      { tierLevel: 'starter', featureKey: 'advanced_analytics', enabled: false },

      // Professional tier
      { tierLevel: 'professional', featureKey: 'max_skus', enabled: true, limitValue: 2000 },
      { tierLevel: 'professional', featureKey: 'max_users', enabled: true, limitValue: 3 },
      {
        tierLevel: 'professional',
        featureKey: 'max_inventory_items',
        enabled: true,
        limitValue: 20000,
      },
      {
        tierLevel: 'professional',
        featureKey: 'storage_bytes',
        enabled: true,
        limitValue: 10737418240,
      },
      { tierLevel: 'professional', featureKey: 'advanced_analytics', enabled: true },

      // Premium tier
      { tierLevel: 'premium', featureKey: 'max_skus', enabled: true, limitValue: null },
      { tierLevel: 'premium', featureKey: 'max_users', enabled: true, limitValue: 10 },
      { tierLevel: 'premium', featureKey: 'max_inventory_items', enabled: true, limitValue: null },
      {
        tierLevel: 'premium',
        featureKey: 'storage_bytes',
        enabled: true,
        limitValue: 107374182400,
      },
      { tierLevel: 'premium', featureKey: 'advanced_analytics', enabled: true },

      // Concierge tier
      { tierLevel: 'concierge', featureKey: 'max_skus', enabled: true, limitValue: null },
      { tierLevel: 'concierge', featureKey: 'max_users', enabled: true, limitValue: 10 },
      {
        tierLevel: 'concierge',
        featureKey: 'max_inventory_items',
        enabled: true,
        limitValue: null,
      },
      { tierLevel: 'concierge', featureKey: 'storage_bytes', enabled: true, limitValue: null },
      { tierLevel: 'concierge', featureKey: 'advanced_analytics', enabled: true },
    ];

    for (const flag of tierFlags) {
      await prisma.tierFeatureFlag.upsert({
        where: {
          tierLevel_featureKey: {
            tierLevel: flag.tierLevel,
            featureKey: flag.featureKey,
          },
        },
        update: flag,
        create: flag,
      });
    }

    console.log('✅ Tier feature flags seeded successfully');
  } catch (error) {
    console.error('❌ Failed to seed tier flags:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
