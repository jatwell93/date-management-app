import { PrismaClient } from '@prisma/client';
import { AnalyticsService } from '../services/analytics.service';
import { ApplicationMonitoringService } from '../services/application.monitoring.service';
import { DatabaseMonitoringService } from '../services/database.monitoring.service';
import { resetOrgCounter } from './helpers/test-factories';

const prisma = new PrismaClient();
const INTEGRATION_TEST_TIMEOUT_MS = 60_000;

// Large integration suites can exceed Jest's default 30s hook timeout on Windows/SQLite.
jest.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

function stopBackgroundServices(): void {
  AnalyticsService.resetInstance();
  const appMonitoring = (
    ApplicationMonitoringService as unknown as {
      instance?: { stopMonitoring: (silent?: boolean) => void };
    }
  ).instance;
  appMonitoring?.stopMonitoring(true);
  const dbMonitoring = (
    DatabaseMonitoringService as unknown as {
      instance?: { stopMonitoring: (silent?: boolean) => void };
    }
  ).instance;
  dbMonitoring?.stopMonitoring(true);
}

beforeEach(async () => {
  const isPostgres = process.env.DATABASE_DRIVER === 'postgresql';
  const testPath =
    (expect as unknown as { getState?: () => { testPath?: string } }).getState?.().testPath || '';
  const isTierFlagsSuite = testPath.includes('validate-tier-flags.test.ts');

  if (isPostgres) {
    if (isTierFlagsSuite) {
      await prisma.$executeRawUnsafe(
        'TRUNCATE TABLE "tier_feature_flags" RESTART IDENTITY CASCADE;',
      );
      resetOrgCounter();
      return;
    }

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "audit_log",
        "item_transactions",
        "expired_item_transactions",
        "inventory_items",
        "products",
        "uploads",
        "store_areas",
        "organization_invites",
        "refresh_tokens",
        "trial_events",
        "organization_usage",
        "subscription_tiers",
        "processed_webhook_events",
        "clerk_webhook_events",
        "tier_feature_flags",
        "users",
        "organizations"
      RESTART IDENTITY CASCADE;
    `);
  } else {
    // SQLite: Disable foreign keys during cleanup
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF;');

    if (isTierFlagsSuite) {
      try {
        await prisma.$executeRawUnsafe('DELETE FROM "tier_feature_flags";');
      } catch (error) {
        // Ignore if table does not exist in this fixture
      }
      await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON;');
      resetOrgCounter();
      return;
    }
  }

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

  if (!isPostgres) {
    // Delete child records first
    for (const table of childTables) {
      try {
        await prisma.$executeRawUnsafe(`DELETE FROM "${table}";`);
      } catch (error) {
        // Table might not exist or already empty
      }
    }

    // Clean parent tables (users + organizations)
    // Child FK references are already deleted above with FKs OFF (SQLite)
    for (const table of ['users', 'organizations']) {
      try {
        await prisma.$executeRawUnsafe(`DELETE FROM "${table}";`);
      } catch (error) {
        // Table might not exist or already empty
      }
    }
  }

  // Seed essential data (Users for legacy tests)
  // Keep this transactional so PostgreSQL always sees parent org before child users.
  await prisma.$transaction(async (tx) => {
    const defaultOrg = await tx.organization.upsert({
      where: { slug: 'default-org' },
      update: {
        name: 'Default Organization',
      },
      create: {
        id: 'default-org',
        name: 'Default Organization',
        slug: 'default-org',
      },
    });

    await tx.user.upsert({
      where: { id: 1 },
      update: {
        role: 'Manager',
        organizationId: defaultOrg.id,
      },
      create: {
        id: 1,
        role: 'Manager',
        organizationId: defaultOrg.id,
      },
    });

    await tx.user.upsert({
      where: { id: 2 },
      update: {
        role: 'Staff',
        organizationId: defaultOrg.id,
      },
      create: {
        id: 2,
        role: 'Staff',
        organizationId: defaultOrg.id,
      },
    });
  });

  // SQLite: Re-enable foreign keys after cleanup
  if (!isPostgres) {
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON;');
  }

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
