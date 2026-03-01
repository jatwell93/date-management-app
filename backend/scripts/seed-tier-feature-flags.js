#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const TIER_FEATURES = [
  // Starter Tier
  { tierLevel: 'starter', featureKey: 'max_skus', limitValue: 500, enabled: true },
  { tierLevel: 'starter', featureKey: 'max_users', limitValue: 1, enabled: true },
  { tierLevel: 'starter', featureKey: 'max_inventory_items', limitValue: 5000, enabled: true },
  { tierLevel: 'starter', featureKey: 'advanced_analytics', enabled: false },
  { tierLevel: 'starter', featureKey: 'api_access', enabled: false },
  { tierLevel: 'starter', featureKey: 'priority_support', enabled: false },

  // Professional Tier
  { tierLevel: 'professional', featureKey: 'max_skus', limitValue: 2000, enabled: true },
  { tierLevel: 'professional', featureKey: 'max_users', limitValue: 3, enabled: true },
  {
    tierLevel: 'professional',
    featureKey: 'max_inventory_items',
    limitValue: 20000,
    enabled: true,
  },
  { tierLevel: 'professional', featureKey: 'advanced_analytics', enabled: true },
  { tierLevel: 'professional', featureKey: 'api_access', enabled: false },
  { tierLevel: 'professional', featureKey: 'priority_support', enabled: false },

  // Premium Tier
  { tierLevel: 'premium', featureKey: 'max_skus', limitValue: null, enabled: true },
  { tierLevel: 'premium', featureKey: 'max_users', limitValue: 10, enabled: true },
  { tierLevel: 'premium', featureKey: 'max_inventory_items', limitValue: null, enabled: true },
  { tierLevel: 'premium', featureKey: 'advanced_analytics', enabled: true },
  { tierLevel: 'premium', featureKey: 'api_access', enabled: true },
  { tierLevel: 'premium', featureKey: 'priority_support', enabled: true },

  // Concierge Tier
  { tierLevel: 'concierge', featureKey: 'max_skus', limitValue: null, enabled: true },
  { tierLevel: 'concierge', featureKey: 'max_users', limitValue: 10, enabled: true },
  { tierLevel: 'concierge', featureKey: 'max_inventory_items', limitValue: null, enabled: true },
  { tierLevel: 'concierge', featureKey: 'advanced_analytics', enabled: true },
  { tierLevel: 'concierge', featureKey: 'api_access', enabled: true },
  { tierLevel: 'concierge', featureKey: 'priority_support', enabled: true },
  { tierLevel: 'concierge', featureKey: 'dedicated_support', enabled: true },
  { tierLevel: 'concierge', featureKey: 'custom_integrations', enabled: true },
];

async function seedTierFeatureFlags() {
  try {
    console.log('Starting tier feature flags seeding...');

    // Clear existing data
    await prisma.tierFeatureFlag.deleteMany({});
    console.log('Cleared existing tier feature flags');

    // Insert new data
    for (const feature of TIER_FEATURES) {
      await prisma.tierFeatureFlag.create({
        data: feature,
      });
    }

    console.log('Tier feature flags seeding completed successfully');

    // Display summary
    const counts = await prisma.tierFeatureFlag.groupBy({
      by: ['tierLevel'],
      _count: true,
    });

    console.log('\n✅ Tier feature flags created:');
    counts.forEach((count) => {
      console.log(`   ${count.tierLevel}: ${count._count} features`);
    });
  } catch (error) {
    console.error('Tier feature flags seeding failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seeding function
seedTierFeatureFlags();
