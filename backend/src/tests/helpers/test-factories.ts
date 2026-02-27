import { PrismaClient } from '@prisma/client';

/**
 * Test factory helpers for creating test data with all required fields
 * Use these in tests to ensure consistent, valid data creation
 */

let orgCounter = 0;

export interface CreateOrgOptions {
  name?: string;
  slug?: string;
  clerkOrganizationId?: string;
  contactEmail?: string;
}

export interface CreateSubscriptionOptions {
  tierLevel?: string;
  status?: string;
  stripeSubscriptionId?: string;
  stripeCustomerId?: string;
  trialEndDate?: Date;
}

export interface CreateUsageOptions {
  maxUsers?: number;
  maxSkus?: number;
  activeUsers?: number;
  totalSkus?: number;
}

/**
 * Creates an Organization with all required fields
 * Automatically generates unique slug if not provided
 */
export async function createTestOrganization(
  prisma: PrismaClient,
  options: CreateOrgOptions = {}
): Promise<{ id: string; slug: string; name: string }> {
  orgCounter++;
  const timestamp = Date.now();
  
  const org = await prisma.organization.create({
    data: {
      name: options.name || `Test Org ${orgCounter}`,
      slug: options.slug || `test-org-${timestamp}-${orgCounter}`,
      clerkOrganizationId: options.clerkOrganizationId || null,
      contactEmail: options.contactEmail || null,
    },
  });

  return org;
}

/**
 * Creates a complete organization with subscription and usage records
 * This is the most common setup for multi-tenant tests
 */
export async function createTestOrgWithSubscription(
  prisma: PrismaClient,
  orgOptions: CreateOrgOptions = {},
  subscriptionOptions: CreateSubscriptionOptions = {},
  usageOptions: CreateUsageOptions = {}
) {
  const org = await createTestOrganization(prisma, orgOptions);

  const subscription = await prisma.subscriptionTier.create({
    data: {
      organizationId: org.id,
      tierLevel: subscriptionOptions.tierLevel || 'starter',
      status: subscriptionOptions.status || 'active',
      stripeSubscriptionId: subscriptionOptions.stripeSubscriptionId || null,
      stripeCustomerId: subscriptionOptions.stripeCustomerId || null,
      trialEndDate: subscriptionOptions.trialEndDate || null,
    },
  });

  const usage = await prisma.organizationUsage.create({
    data: {
      organizationId: org.id,
      maxUsers: usageOptions.maxUsers ?? 1,
      maxSkus: usageOptions.maxSkus ?? 500,
      activeUsers: usageOptions.activeUsers ?? 0,
      totalSkus: usageOptions.totalSkus ?? 0,
    },
  });

  return { org, subscription, usage };
}

/**
 * Creates multiple test organizations for cross-tenant isolation tests
 */
export async function createMultipleTestOrgs(
  prisma: PrismaClient,
  count: number = 2
) {
  const orgs = [];
  
  for (let i = 0; i < count; i++) {
    const org = await createTestOrgWithSubscription(prisma);
    orgs.push(org);
  }
  
  return orgs;
}

/**
 * Reset the organization counter (useful in global beforeEach)
 */
export function resetOrgCounter() {
  orgCounter = 0;
}
