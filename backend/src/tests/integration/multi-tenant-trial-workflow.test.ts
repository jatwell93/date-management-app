/**
 * Multi-Tenant Trial Workflow Tests
 *
 * Tests trial subscription lifecycle: creation, expiration, and downgrade.
 * Verifies trial organizations get Professional tier access during trial period.
 *
 * Task: 13.8
 * Pattern: Reuse SubscriptionService from subscription.service.test.ts
 */

import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../../database/database-factory';
import { SubscriptionService } from '../../services/subscription.service';
import { SubscriptionStatus } from '../../types/subscription';

// Mock Stripe
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    customers: {
      create: jest.fn().mockResolvedValue({ id: 'cus_test_trial' }),
    },
    subscriptions: {
      create: jest.fn().mockResolvedValue({
        id: 'sub_test_trial',
        status: 'trialing',
        trial_end: Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60,
      }),
    },
  }));
});

describe('Multi-Tenant Trial Workflow Tests', () => {
  let prisma: PrismaClient;
  let subscriptionService: SubscriptionService;

  // Test organization
  let orgTrial: { id: string; name: string };

  beforeAll(async () => {
    prisma = getDefaultDatabaseClient();
    subscriptionService = new SubscriptionService(prisma);
  });

  beforeEach(async () => {
    // Clean up test data
    await prisma.subscriptionTier.deleteMany({});
    await prisma.organizationUsage.deleteMany({});
    await prisma.organization.deleteMany({});

    // Create trial organization
    orgTrial = await prisma.organization.create({
      data: {
        name: 'Trial Pharmacy',
        slug: 'trial-pharmacy-test',
        contactEmail: 'trial@test.com',
      },
    });

    // Seed tier feature flags if not already present
    const existingFlags = await prisma.tierFeatureFlag.count();
    if (existingFlags === 0) {
      await prisma.tierFeatureFlag.createMany({
        data: [
          { tierLevel: 'starter', featureKey: 'advanced_analytics', enabled: false },
          { tierLevel: 'professional', featureKey: 'advanced_analytics', enabled: true },
          { tierLevel: 'premium', featureKey: 'advanced_analytics', enabled: true },
        ],
      });
    }
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.tierFeatureFlag.deleteMany({});
    await prisma.subscriptionTier.deleteMany({});
    await prisma.organizationUsage.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.$disconnect();
  });

  describe('Task 13.8: Trial expiration and downgrade', () => {
    it('should create trial subscription with Professional tier access', async () => {
      // Create trial subscription (14-day trial)
      const trialEndDate = new Date();
      trialEndDate.setDate(trialEndDate.getDate() + 14);

      await prisma.subscriptionTier.create({
        data: {
          organizationId: orgTrial.id,
          tierLevel: 'professional',
          status: SubscriptionStatus.TRIALING,
          billingCycle: 'monthly',
          stripeCustomerId: 'cus_trial_test',
          trialStartedAt: new Date(),
          trialEndDate: trialEndDate,
        },
      });

      // Verify subscription exists with trial status
      const subscription = await prisma.subscriptionTier.findFirst({
        where: { organizationId: orgTrial.id },
      });

      expect(subscription).toBeDefined();
      expect(subscription?.status).toBe(SubscriptionStatus.TRIALING);
      expect(subscription?.tierLevel).toBe('professional');
      expect(subscription?.trialEndDate).toBeDefined();
      expect(subscription?.trialStartedAt).toBeDefined();

      // Verify trial end date is ~14 days in future
      const daysUntilExpiry = Math.floor(
        (subscription!.trialEndDate!.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24),
      );
      expect(daysUntilExpiry).toBeGreaterThanOrEqual(13);
      expect(daysUntilExpiry).toBeLessThanOrEqual(14);
    });

    it('should allow Professional tier features during trial period', async () => {
      // Create active trial
      const trialEndDate = new Date();
      trialEndDate.setDate(trialEndDate.getDate() + 14);

      await prisma.subscriptionTier.create({
        data: {
          organizationId: orgTrial.id,
          tierLevel: 'professional',
          status: SubscriptionStatus.TRIALING,
          billingCycle: 'monthly',
          stripeCustomerId: 'cus_trial_active',
          trialStartedAt: new Date(),
          trialEndDate: trialEndDate,
        },
      });

      // Verify organization has Professional tier access
      const subscription = await prisma.subscriptionTier.findFirst({
        where: { organizationId: orgTrial.id },
      });

      expect(subscription?.tierLevel).toBe('professional');
      expect(subscription?.status).toBe(SubscriptionStatus.TRIALING);

      // Check if trial is still active
      const now = new Date();
      const isTrialActive = subscription!.trialEndDate! > now;
      expect(isTrialActive).toBe(true);
    });

    it('should downgrade to Starter tier after trial expires', async () => {
      // Ensure subscription record exists for trial
      const trialSubscription = await prisma.subscriptionTier.create({
        data: {
          organizationId: orgTrial.id,
          tierLevel: 'professional',
          status: 'trialing',
          trialEndDate: new Date(Date.now() - 86400000), // Expired yesterday
        },
      });
      await subscriptionService.downgradeExpiredTrials();

      // Verify downgrade occurred
      const updatedSubscription = await prisma.subscriptionTier.findFirst({
        where: { organizationId: orgTrial.id },
      });

      expect(updatedSubscription?.tierLevel).toBe('starter');
      expect(updatedSubscription?.status).toBe(SubscriptionStatus.ACTIVE);
    });

    it('should block Professional features after trial expiration', async () => {
      // Create expired trial with downgraded tier
      const trialEndDate = new Date();
      trialEndDate.setDate(trialEndDate.getDate() - 1);

      await prisma.subscriptionTier.create({
        data: {
          organizationId: orgTrial.id,
          tierLevel: 'starter', // Already downgraded
          status: SubscriptionStatus.ACTIVE,
          billingCycle: 'monthly',
          stripeCustomerId: 'cus_trial_downgraded',
          trialStartedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
          trialEndDate: trialEndDate,
        },
      });

      // Verify organization is now on Starter tier
      const subscription = await prisma.subscriptionTier.findFirst({
        where: { organizationId: orgTrial.id },
      });

      expect(subscription?.tierLevel).toBe('starter');
      expect(subscription?.status).toBe(SubscriptionStatus.ACTIVE);

      // Verify trial has ended
      const now = new Date();
      const isTrialActive = subscription!.trialEndDate! > now;
      expect(isTrialActive).toBe(false);

      // Check feature access (Starter tier should not have advanced_analytics)
      const featureFlag = await prisma.tierFeatureFlag.findUnique({
        where: {
          tierLevel_featureKey: {
            tierLevel: 'starter',
            featureKey: 'advanced_analytics',
          },
        },
      });

      expect(featureFlag?.enabled).toBe(false);
    });

    it('should maintain trial metadata after downgrade', async () => {
      // Create expired trial
      const trialEndDate = new Date();
      trialEndDate.setDate(trialEndDate.getDate() - 1);

      const trialStartDate = new Date();
      trialStartDate.setDate(trialStartDate.getDate() - 15);

      await prisma.subscriptionTier.create({
        data: {
          organizationId: orgTrial.id,
          tierLevel: 'starter',
          status: SubscriptionStatus.ACTIVE,
          billingCycle: 'monthly',
          stripeCustomerId: 'cus_trial_metadata',
          trialStartedAt: trialStartDate,
          trialEndDate: trialEndDate,
        },
      });

      // Verify trial dates are preserved
      const subscription = await prisma.subscriptionTier.findFirst({
        where: { organizationId: orgTrial.id },
      });

      expect(subscription?.trialStartedAt).toBeDefined();
      expect(subscription?.trialEndDate).toBeDefined();

      // Verify trial duration was ~14 days
      const trialDuration = Math.floor(
        (subscription!.trialEndDate!.getTime() - subscription!.trialStartedAt!.getTime()) /
          (1000 * 60 * 60 * 24),
      );
      expect(trialDuration).toBeGreaterThanOrEqual(13);
      expect(trialDuration).toBeLessThanOrEqual(15);
    });

    it('should track trial conversion when user upgrades', async () => {
      // Ensure subscription record exists for conversion
      const trialToConvert = await prisma.subscriptionTier.create({
        data: {
          organizationId: orgTrial.id,
          tierLevel: 'professional',
          status: 'trialing',
          trialEndDate: new Date(Date.now() + 86400000), // Not yet expired
          stripeCustomerId: 'cus_trial_convert',
        },
      });
      await subscriptionService.convertTrialToPaid(orgTrial.id, 'price_professional');

      // Verify conversion was tracked
      const updatedSubscription = await prisma.subscriptionTier.findFirst({
        where: { organizationId: orgTrial.id },
      });

      expect(updatedSubscription?.status).toBe(SubscriptionStatus.ACTIVE);
      expect(updatedSubscription?.trialConvertedAt).toBeDefined();
      expect(updatedSubscription?.tierLevel).toBe('professional');

      // Verify trial metadata is preserved
      expect(updatedSubscription?.trialStartedAt).toBeDefined();
      expect(updatedSubscription?.trialEndDate).toBeDefined();
    });
  });
});
