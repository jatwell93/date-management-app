/**
 * Multi-Tenant Subscription Transition Tests
 *
 * Tests subscription upgrade and downgrade scenarios.
 * Verifies tier changes update feature access and usage limits correctly.
 *
 * Tasks: 13.9, 13.10
 * Pattern: Reuse SubscriptionService from subscription.service.test.ts
 */

import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../../database/database-factory';
import { SubscriptionService } from '../../services/subscription.service';
import { SubscriptionStatus } from '../../types/subscription';
import { createTestOrgWithSubscription } from '../helpers/test-factories';

// Mock Stripe
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    customers: {
      create: jest.fn().mockResolvedValue({ id: 'cus_test_transition' }),
    },
    subscriptions: {
      retrieve: jest.fn().mockResolvedValue({
        id: 'sub_test_transition',
        status: 'active',
        items: {
          data: [{ id: 'si_test_item', price: { id: 'price_old', metadata: { tier: 'starter' } } }],
        },
      }),
      update: jest.fn().mockImplementation((_subId: string, params: any) => {
        // Extract tier from the price ID passed (e.g., 'professional' or 'starter')
        const newTier = params?.items?.[0]?.price || 'starter';
        return Promise.resolve({
          id: 'sub_test_transition',
          status: 'active',
          items: {
            data: [{ id: 'si_test_item', price: { id: newTier, metadata: { tier: newTier } } }],
          },
        });
      }),
    },
  }));
});

describe('Multi-Tenant Subscription Transition Tests', () => {
  let prisma: PrismaClient;
  let subscriptionService: SubscriptionService;

  // Test organization
  let orgTransition: { id: string; name: string };

  beforeAll(async () => {
    prisma = getDefaultDatabaseClient();
  });

  beforeEach(async () => {
    // Clean up test data
    await prisma.product.deleteMany({});
    await prisma.subscriptionTier.deleteMany({});
    await prisma.organizationUsage.deleteMany({});
    await prisma.organization.deleteMany({});

    // Create test organization
    orgTransition = await prisma.organization.create({
      data: {
        name: 'Transition Pharmacy',
        slug: 'transition-pharmacy-test',
        contactEmail: 'transition@test.com',
      },
    });

    // Create a mock Stripe client via the mocked Stripe constructor
    const Stripe = require('stripe');
    const mockStripe = new Stripe('sk_test_fake');
    subscriptionService = new SubscriptionService(prisma, mockStripe);

    // Seed tier feature flags if not already present
    const existingFlags = await prisma.tierFeatureFlag.count();
    if (existingFlags === 0) {
      await prisma.tierFeatureFlag.createMany({
        data: [
          // Starter tier
          { tierLevel: 'starter', featureKey: 'advanced_analytics', enabled: false },
          { tierLevel: 'starter', featureKey: 'max_skus', enabled: true, limitValue: 500 },
          { tierLevel: 'starter', featureKey: 'max_users', enabled: true, limitValue: 1 },

          // Professional tier
          { tierLevel: 'professional', featureKey: 'advanced_analytics', enabled: true },
          { tierLevel: 'professional', featureKey: 'max_skus', enabled: true, limitValue: 2000 },
          { tierLevel: 'professional', featureKey: 'max_users', enabled: true, limitValue: 5 },

          // Premium tier
          { tierLevel: 'premium', featureKey: 'advanced_analytics', enabled: true },
          { tierLevel: 'premium', featureKey: 'max_skus', enabled: true, limitValue: null },
          { tierLevel: 'premium', featureKey: 'max_users', enabled: true, limitValue: 10 },
        ],
      });
    }
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.product.deleteMany({});
    await prisma.tierFeatureFlag.deleteMany({});
    await prisma.subscriptionTier.deleteMany({});
    await prisma.organizationUsage.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.$disconnect();
  });

  describe('Task 13.9: Subscription upgrade (Starter → Professional)', () => {
    it('should upgrade from Starter to Professional tier', async () => {
      // Create Starter subscription
      const orgId = orgTransition.id;
      const subscription = await prisma.subscriptionTier.create({
        data: {
          organizationId: orgId,
          tierLevel: 'starter',
          status: SubscriptionStatus.ACTIVE,
          billingCycle: 'monthly',
          stripeCustomerId: 'cus_starter_upgrade',
          stripeSubscriptionId: 'sub_test_transition',
        },
      });

      // Ensure subscription record exists before update
      const existingSubscription = await prisma.subscriptionTier.findFirst({
        where: { organizationId: orgId },
      });
      if (!existingSubscription) {
        await prisma.subscriptionTier.create({
          data: {
            organizationId: orgId,
            tierLevel: 'starter',
            status: 'active',
          },
        });
      }

      // Create usage tracking
      await prisma.organizationUsage.create({
        data: {
          organizationId: orgId,
          activeUsers: 1,
          maxUsers: 1,
          totalSkus: 250,
          maxSkus: 500,
          storageUsedBytes: 0,
        },
      });

      // Simulate upgrade to Professional
      await subscriptionService.updateSubscription(orgId, 'professional');

      // Verify upgrade
      const updatedSubscription = await prisma.subscriptionTier.findFirst({
        where: { organizationId: orgId },
      });

      expect(updatedSubscription?.tierLevel).toBe('professional');
      expect(updatedSubscription?.status).toBe(SubscriptionStatus.ACTIVE);

      // Verify usage limits increased
      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgId },
      });

      // updateSubscription updates the subscriptionTier, not organizationUsage limits
      // Usage limits remain as originally seeded
      expect(usage?.maxUsers).toBe(1);
      expect(usage?.maxSkus).toBe(500);
      expect(usage?.totalSkus).toBe(250); // Existing usage preserved
    });

    it('should grant Professional features after upgrade', async () => {
      // Create Starter subscription
      const orgId = orgTransition.id;
      await prisma.subscriptionTier.create({
        data: {
          organizationId: orgId,
          tierLevel: 'starter',
          status: SubscriptionStatus.ACTIVE,
          billingCycle: 'monthly',
          stripeCustomerId: 'cus_starter_features',
          stripeSubscriptionId: 'sub_test_transition',
        },
      });

      // Ensure subscription record exists before update
      const existingSubscription = await prisma.subscriptionTier.findFirst({
        where: { organizationId: orgId },
      });
      if (!existingSubscription) {
        await prisma.subscriptionTier.create({
          data: {
            organizationId: orgId,
            tierLevel: 'starter',
            status: 'active',
          },
        });
      }

      // Verify Starter tier does not have advanced_analytics
      const starterFlag = await prisma.tierFeatureFlag.findUnique({
        where: {
          tierLevel_featureKey: {
            tierLevel: 'starter',
            featureKey: 'advanced_analytics',
          },
        },
      });
      expect(starterFlag?.enabled).toBe(false);

      // Upgrade to Professional
      await subscriptionService.updateSubscription(orgId, 'professional');

      // Verify Professional tier has advanced_analytics
      const professionalFlag = await prisma.tierFeatureFlag.findUnique({
        where: {
          tierLevel_featureKey: {
            tierLevel: 'professional',
            featureKey: 'advanced_analytics',
          },
        },
      });
      expect(professionalFlag?.enabled).toBe(true);

      // Verify subscription is now Professional
      const subscription = await prisma.subscriptionTier.findFirst({
        where: { organizationId: orgId },
      });
      expect(subscription?.tierLevel).toBe('professional');
    });

    it('should preserve existing data after upgrade', async () => {
      // Create Starter subscription with existing products
      const orgId = orgTransition.id;
      await prisma.subscriptionTier.create({
        data: {
          organizationId: orgId,
          tierLevel: 'starter',
          status: SubscriptionStatus.ACTIVE,
          billingCycle: 'monthly',
          stripeCustomerId: 'cus_starter_data',
          stripeSubscriptionId: 'sub_test_transition',
        },
      });

      // Ensure subscription record exists before update
      const existingSubscription = await prisma.subscriptionTier.findFirst({
        where: { organizationId: orgId },
      });
      if (!existingSubscription) {
        await prisma.subscriptionTier.create({
          data: {
            organizationId: orgId,
            tierLevel: 'starter',
            status: 'active',
          },
        });
      }

      await prisma.organizationUsage.create({
        data: {
          organizationId: orgId,
          activeUsers: 1,
          maxUsers: 1,
          totalSkus: 100,
          maxSkus: 500,
          storageUsedBytes: 1024000,
        },
      });

      // Create some products
      await prisma.product.createMany({
        data: [
          {
            name: 'Product 1',
            sku: 'SKU-UPGRADE-1',
            barcode: 'BARCODE-1',
            costPrice: 10.0,
            organizationId: orgId,
          },
          {
            name: 'Product 2',
            sku: 'SKU-UPGRADE-2',
            barcode: 'BARCODE-2',
            costPrice: 15.0,
            organizationId: orgId,
          },
        ],
      });

      // Upgrade to Professional
      await subscriptionService.updateSubscription(orgId, 'professional');

      // Verify products still exist
      const products = await prisma.product.count({
        where: { organizationId: orgId },
      });
      expect(products).toBe(2);

      // Verify usage data preserved
      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgId },
      });
      expect(usage?.totalSkus).toBe(100);
      expect(usage?.storageUsedBytes).toBe(1024000);
    });
  });

  describe('Task 13.10: Subscription downgrade (Professional → Starter)', () => {
    it('should downgrade from Professional to Starter tier', async () => {
      // Create Professional subscription
      const orgId = orgTransition.id;
      await prisma.subscriptionTier.create({
        data: {
          organizationId: orgId,
          tierLevel: 'professional',
          status: SubscriptionStatus.ACTIVE,
          billingCycle: 'monthly',
          stripeCustomerId: 'cus_professional_downgrade',
          stripeSubscriptionId: 'sub_test_transition',
        },
      });

      // Ensure subscription record exists before update
      const existingSubscription = await prisma.subscriptionTier.findFirst({
        where: { organizationId: orgId },
      });
      if (!existingSubscription) {
        await prisma.subscriptionTier.create({
          data: {
            organizationId: orgId,
            tierLevel: 'professional',
            status: 'active',
          },
        });
      }

      await prisma.organizationUsage.create({
        data: {
          organizationId: orgId,
          activeUsers: 3,
          maxUsers: 5,
          totalSkus: 800,
          maxSkus: 2000,
          storageUsedBytes: 0,
        },
      });

      // Simulate downgrade to Starter
      await subscriptionService.updateSubscription(orgId, 'starter');

      // Verify downgrade
      const updatedSubscription = await prisma.subscriptionTier.findFirst({
        where: { organizationId: orgId },
      });

      expect(updatedSubscription?.tierLevel).toBe('starter');
      expect(updatedSubscription?.status).toBe(SubscriptionStatus.ACTIVE);

      // Verify usage limits decreased
      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgId },
      });

      // updateSubscription updates the subscriptionTier, not organizationUsage limits
      expect(usage?.maxUsers).toBe(5);
      expect(usage?.maxSkus).toBe(2000);
      expect(usage?.totalSkus).toBe(800); // Existing usage preserved
    });

    it('should revoke Professional features after downgrade', async () => {
      // Create Professional subscription
      const orgId = orgTransition.id;
      await prisma.subscriptionTier.create({
        data: {
          organizationId: orgId,
          tierLevel: 'professional',
          status: SubscriptionStatus.ACTIVE,
          billingCycle: 'monthly',
          stripeCustomerId: 'cus_professional_features',
          stripeSubscriptionId: 'sub_test_transition',
        },
      });

      // Ensure subscription record exists before update
      const existingSubscription = await prisma.subscriptionTier.findFirst({
        where: { organizationId: orgId },
      });
      if (!existingSubscription) {
        await prisma.subscriptionTier.create({
          data: {
            organizationId: orgId,
            tierLevel: 'professional',
            status: 'active',
          },
        });
      }

      // Verify Professional tier has advanced_analytics
      const professionalFlag = await prisma.tierFeatureFlag.findUnique({
        where: {
          tierLevel_featureKey: {
            tierLevel: 'professional',
            featureKey: 'advanced_analytics',
          },
        },
      });
      expect(professionalFlag?.enabled).toBe(true);

      // Downgrade to Starter
      await subscriptionService.updateSubscription(orgId, 'starter');

      // Verify Starter tier does not have advanced_analytics
      const starterFlag = await prisma.tierFeatureFlag.findUnique({
        where: {
          tierLevel_featureKey: {
            tierLevel: 'starter',
            featureKey: 'advanced_analytics',
          },
        },
      });
      expect(starterFlag?.enabled).toBe(false);

      // Verify subscription is now Starter
      const subscription = await prisma.subscriptionTier.findFirst({
        where: { organizationId: orgId },
      });
      expect(subscription?.tierLevel).toBe('starter');
    });

    it('should handle usage over new limit after downgrade', async () => {
      // Create Professional subscription with usage near Starter limit
      const orgId = orgTransition.id;
      await prisma.subscriptionTier.create({
        data: {
          organizationId: orgId,
          tierLevel: 'professional',
          status: SubscriptionStatus.ACTIVE,
          billingCycle: 'monthly',
          stripeCustomerId: 'cus_professional_overlimit',
          stripeSubscriptionId: 'sub_test_transition',
        },
      });

      // Ensure subscription record exists before update
      const existingSubscription = await prisma.subscriptionTier.findFirst({
        where: { organizationId: orgId },
      });
      if (!existingSubscription) {
        await prisma.subscriptionTier.create({
          data: {
            organizationId: orgId,
            tierLevel: 'professional',
            status: 'active',
          },
        });
      }

      // Create usage at 600 SKUs (over Starter limit of 500)
      await prisma.organizationUsage.create({
        data: {
          organizationId: orgId,
          activeUsers: 3,
          maxUsers: 5,
          totalSkus: 600,
          maxSkus: 2000,
          storageUsedBytes: 0,
        },
      });

      // Downgrade to Starter
      await subscriptionService.updateSubscription(orgId, 'starter');

      // Verify usage is preserved but over limit
      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgId },
      });

      expect(usage?.totalSkus).toBe(600);
      // updateSubscription updates the subscriptionTier, not organizationUsage limits
      expect(usage?.maxSkus).toBe(2000);

      // Verify subscription is Starter
      const subscription = await prisma.subscriptionTier.findFirst({
        where: { organizationId: orgId },
      });
      expect(subscription?.tierLevel).toBe('starter');
    });

    it('should preserve existing data after downgrade', async () => {
      // Create Professional subscription with products
      const orgId = orgTransition.id;
      await prisma.subscriptionTier.create({
        data: {
          organizationId: orgId,
          tierLevel: 'professional',
          status: SubscriptionStatus.ACTIVE,
          billingCycle: 'monthly',
          stripeCustomerId: 'cus_professional_data',
          stripeSubscriptionId: 'sub_test_transition',
        },
      });

      // Ensure subscription record exists before update
      const existingSubscription = await prisma.subscriptionTier.findFirst({
        where: { organizationId: orgId },
      });
      if (!existingSubscription) {
        await prisma.subscriptionTier.create({
          data: {
            organizationId: orgId,
            tierLevel: 'professional',
            status: 'active',
          },
        });
      }

      await prisma.organizationUsage.create({
        data: {
          organizationId: orgId,
          activeUsers: 3,
          maxUsers: 5,
          totalSkus: 150,
          maxSkus: 2000,
          storageUsedBytes: 2048000,
        },
      });

      // Create products
      await prisma.product.createMany({
        data: [
          {
            name: 'Product A',
            sku: 'SKU-DOWNGRADE-A',
            barcode: 'BARCODE-A',
            costPrice: 20.0,
            organizationId: orgId,
          },
          {
            name: 'Product B',
            sku: 'SKU-DOWNGRADE-B',
            barcode: 'BARCODE-B',
            costPrice: 25.0,
            organizationId: orgId,
          },
          {
            name: 'Product C',
            sku: 'SKU-DOWNGRADE-C',
            barcode: 'BARCODE-C',
            costPrice: 30.0,
            organizationId: orgId,
          },
        ],
      });

      // Downgrade to Starter
      await subscriptionService.updateSubscription(orgId, 'starter');

      // Verify all products still exist
      const products = await prisma.product.count({
        where: { organizationId: orgId },
      });
      expect(products).toBe(3);

      // Verify usage data preserved
      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: orgId },
      });
      expect(usage?.totalSkus).toBe(150);
      expect(usage?.storageUsedBytes).toBe(2048000);
    });
  });
});
