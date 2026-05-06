// Enable decorators for dependency injection
// Must be imported before any DI operations
import 'reflect-metadata';

import { PrismaClient } from '@prisma/client';
import { AnalyticsService } from '../services/analytics.service';
import { ApplicationMonitoringService } from '../services/application.monitoring.service';
import { DatabaseMonitoringService } from '../services/database.monitoring.service';
import { resetDiContainer } from '../di/container';
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

function isPostgresRuntime(): boolean {
  const databaseUrl = process.env.DATABASE_URL;
  return (
    process.env.DATABASE_DRIVER === 'postgresql' ||
    databaseUrl?.startsWith('postgresql://') === true ||
    databaseUrl?.startsWith('postgres://') === true
  );
}

function isCiRuntime(): boolean {
  return process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
}

function isUnitTestSuite(testPath: string): boolean {
  return /[\\/]tests[\\/]unit[\\/]/.test(testPath);
}

function assertSupportedDatabaseUrl(isPostgres: boolean): void {
  const databaseUrl = process.env.DATABASE_URL;
  const hasSqliteUrl = databaseUrl?.startsWith('file:') === true;

  if (isPostgres || hasSqliteUrl) {
    return;
  }

  const message =
    `Unsupported test DATABASE_URL (${databaseUrl ?? 'undefined'}). ` +
    'Expected PostgreSQL URL or SQLite file: URL.';

  if (isCiRuntime()) {
    throw new Error(message);
  }

  // Local-only soft warning to avoid blocking exploratory runs with partial env setup.
  console.warn(`Skipping Prisma setup: ${message}`);
}

async function cleanupTierFlagsForPostgres(): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "tier_feature_flags" RESTART IDENTITY CASCADE;');
}

async function cleanupAllTablesForPostgres(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "audit_log",
      "org_audit_log",
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
}

async function cleanupTierFlagsForSqlite(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe('DELETE FROM "tier_feature_flags";');
  } catch {
    // Ignore if table does not exist in this fixture
  }
}

async function cleanupTablesForSqlite(): Promise<void> {
  const childTables = [
    'audit_log',
    'org_audit_log',
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
    } catch {
      // Table might not exist or already empty
    }
  }

  // Clean parent tables after children to avoid FK issues.
  for (const table of ['users', 'organizations']) {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "${table}";`);
    } catch {
      // Table might not exist or already empty
    }
  }
}

async function seedDefaultOrganizationAndUsers(): Promise<void> {
  // Keep this transactional so PostgreSQL always sees parent org before child users.
  await prisma.$transaction(async (tx) => {
    const defaultOrg = await tx.organization.upsert({
      where: { id: 'default-org' },
      update: {
        name: 'Default Organization',
        slug: 'default-org',
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
        role: 'admin',
        organizationId: defaultOrg.id,
      },
      create: {
        id: 1,
        role: 'admin',
        organizationId: defaultOrg.id,
      },
    });

    await tx.user.upsert({
      where: { id: 2 },
      update: {
        role: 'team_member',
        organizationId: defaultOrg.id,
      },
      create: {
        id: 2,
        role: 'team_member',
        organizationId: defaultOrg.id,
      },
    });
  });
}

beforeEach(async () => {
  const testPath =
    (expect as unknown as { getState?: () => { testPath?: string } }).getState?.().testPath || '';
  const isUnitSuite = isUnitTestSuite(testPath);
  const isPostgres = isUnitSuite ? false : isPostgresRuntime();
  const isTierFlagsSuite = testPath.includes('validate-tier-flags.test.ts');

  try {
    // Unit tests may intentionally mutate DATABASE_URL and should not be blocked by global DB URL assertions.
    if (!isUnitSuite) {
      assertSupportedDatabaseUrl(isPostgres);
    }
  } catch (error) {
    if (isCiRuntime()) {
      throw error;
    }
    return;
  }

  try {
    if (isPostgres) {
      if (isTierFlagsSuite) {
        await cleanupTierFlagsForPostgres();
        resetOrgCounter();
        return;
      }

      await cleanupAllTablesForPostgres();
    } else {
      // SQLite: Disable foreign keys during cleanup
      await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF;');

      if (isTierFlagsSuite) {
        await cleanupTierFlagsForSqlite();
        await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON;');
        resetOrgCounter();
        return;
      }
    }
  } catch (error) {
    console.warn(
      `⚠️  Failed to cleanup test database: ${error instanceof Error ? error.message : String(error)}`,
    );
    // Don't fail the test setup due to cleanup errors
  }

  if (!isPostgres) {
    await cleanupTablesForSqlite();
  }

  await seedDefaultOrganizationAndUsers();

  // SQLite: Re-enable foreign keys after cleanup
  if (!isPostgres) {
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON;');
  }

  // Reset factory counters for consistent test data
  resetOrgCounter();
});

afterEach(() => {
  stopBackgroundServices();
  resetDiContainer();
});

afterAll(async () => {
  stopBackgroundServices();
  await prisma.$disconnect();
});
