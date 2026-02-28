import { PrismaClient } from '@prisma/client';
import { AnalyticsService } from '../services/analytics.service';
import { ApplicationMonitoringService } from '../services/application.monitoring.service';
import { DatabaseMonitoringService } from '../services/database.monitoring.service';
import { resetOrgCounter } from './helpers/test-factories';

const prisma = new PrismaClient();

function stopBackgroundServices(): void {
  AnalyticsService.resetInstance();
  ApplicationMonitoringService.getInstance().stopMonitoring(true);
  DatabaseMonitoringService.getInstance().stopMonitoring(true);
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF;');

  // Clean up tables in dependency order (children first, then parents)
  // This prevents FK violations during cleanup
  const childTables = [
    'audit_log',
    'item_transactions',
    'expired_item_transactions',
    'inventory_items',
    'products',
    'uploads',
    'store_areas',
    'organization_invites',
    'refresh_tokens',
    'trial_events',
    'organization_usage',
    'subscription_tiers',
    'processed_webhook_events',
    'clerk_webhook_events',
    'tier_feature_flags',
  ];

  // Delete child records first
  for (const table of childTables) {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "${table}";`);
    } catch (error) {
      // Table might not exist or already empty
    }
  }

  // Clean parent tables (users + organizations)
  // Child FK references are already deleted above with FKs OFF
  for (const table of ['users', 'organizations']) {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "${table}";`);
    } catch (error) {
      // Table might not exist or already empty
    }
  }

  // Seed essential data (Users for legacy tests)
  // First create the default organization, then link users to it
  await prisma.organization.upsert({
    where: { id: 'default-org' },
    update: {},
    create: {
      id: 'default-org',
      name: 'Default Organization',
      slug: 'default-org',
    },
  });

  await Promise.all([
    prisma.user.upsert({
      where: { id: 1 },
      update: {
        role: 'Manager',
      },
      create: {
        id: 1,
        role: 'Manager',
        organizationId: 'default-org',
      },
    }),
    prisma.user.upsert({
      where: { id: 2 },
      update: {
        role: 'Staff',
      },
      create: {
        id: 2,
        role: 'Staff',
        organizationId: 'default-org',
      },
    }),
  ]);

  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON;');

  // Reset factory counters for consistent test data
  resetOrgCounter();
});

afterEach(() => {
  stopBackgroundServices();
});

afterAll(async () => {
  stopBackgroundServices();
  await prisma.$disconnect();
});
