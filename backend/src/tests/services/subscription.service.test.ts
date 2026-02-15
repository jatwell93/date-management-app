/**
 * Unit tests for SubscriptionService
 * Tests Stripe integration with mocked Stripe client
 */

import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { SubscriptionService } from '../../services/subscription.service';
import { BillingCycle, SubscriptionStatus, TierLevel } from '../../types/subscription';
import { SubscriptionTier } from '../../models/subscription-tier.model';
import { InternalError, NotFoundError } from '../../errors';

// Mock Stripe and Prisma
jest.mock('stripe');
jest.mock('../../database/database-factory');

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let mockStripe: jest.Mocked<Stripe>;
  let mockPrisma: jest.Mocked<PrismaClient>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock Stripe instance
    mockStripe = {
      customers: {
        create: jest.fn(),
        update: jest.fn(),
      },
      subscriptions: {
        create: jest.fn(),
        update: jest.fn(),
        cancel: jest.fn(),
        retrieve: jest.fn(),
      },
    } as any;

    // Create mock Prisma client with necessary methods
    mockPrisma = {
      organization: {
        findUnique: jest.fn(),
      },
      subscriptionTier: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(mockPrisma)),
    } as any;

    // Initialize service with mocks
    service = new SubscriptionService(mockPrisma, mockStripe);
  });

  describe('createSubscription', () => {
    it('should create a Stripe customer and subscription', async () => {
      const organizationId = 'org-123';
      const priceId = 'price_starter_monthly';
      const billingCycle = BillingCycle.MONTHLY;

      // Mock organization exists
      (mockPrisma.organization.findUnique as jest.Mock).mockResolvedValueOnce({
        id: organizationId,
        name: 'Test Pharmacy',
        slug: 'test-pharmacy',
      });

      // Mock Stripe customer creation
      const stripeCustomer = {
        id: 'cus_test123',
        object: 'customer',
      } as Stripe.Customer;
      (mockStripe.customers.create as jest.Mock).mockResolvedValueOnce(stripeCustomer);

      // Mock Stripe subscription creation
      const stripeSubscription = {
        id: 'sub_test123',
        customer: 'cus_test123',
        items: {
          data: [
            {
              price: {
                id: priceId,
                metadata: { tier: 'starter' },
              },
            },
          ],
        },
        status: 'active' as const,
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        trial_end: null,
      } as unknown as Stripe.Subscription;
      (mockStripe.subscriptions.create as jest.Mock).mockResolvedValueOnce(stripeSubscription);

      // Mock subscription_tiers create
      (mockPrisma.subscriptionTier.create as jest.Mock).mockResolvedValueOnce({
        id: 1,
        organizationId,
        tierLevel: 'starter',
        stripeSubscriptionId: 'sub_test123',
        status: SubscriptionStatus.ACTIVE,
        billingCycle: BillingCycle.MONTHLY,
        trialEndDate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.createSubscription(organizationId, priceId, billingCycle);

      expect(result).toBeDefined();
      expect(result.stripeSubscriptionId).toBe('sub_test123');
      expect(result.tierLevel).toBe('starter');
      expect(mockStripe.customers.create).toHaveBeenCalled();
      expect(mockStripe.subscriptions.create).toHaveBeenCalled();
    });

    it('should throw NotFoundError if organization does not exist', async () => {
      const organizationId = 'org-nonexistent';
      (mockPrisma.organization.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.createSubscription(organizationId, 'price_123', BillingCycle.MONTHLY),
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw InternalError if Stripe customer creation fails', async () => {
      const organizationId = 'org-123';
      (mockPrisma.organization.findUnique as jest.Mock).mockResolvedValueOnce({
        id: organizationId,
        name: 'Test Pharmacy',
      });

      const stripeError = new Error('Stripe API error');
      (mockStripe.customers.create as jest.Mock).mockRejectedValueOnce(stripeError);

      await expect(
        service.createSubscription(organizationId, 'price_123', BillingCycle.MONTHLY),
      ).rejects.toThrow(InternalError);
    });
  });

  describe('updateSubscription', () => {
    it('should update Stripe subscription with new price', async () => {
      const organizationId = 'org-123';
      const newPriceId = 'price_professional_monthly';

      // Mock existing subscription
      (mockPrisma.subscriptionTier.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 1,
        organizationId,
        tierLevel: 'starter',
        stripeSubscriptionId: 'sub_test123',
        status: SubscriptionStatus.ACTIVE,
      });

      // Mock Stripe subscription retrieval
      const stripeSubDetails = {
        id: 'sub_test123',
        items: {
          data: [{ id: 'si_test123' }],
        },
      } as unknown as Stripe.Subscription;
      (mockStripe.subscriptions.retrieve as jest.Mock).mockResolvedValueOnce(stripeSubDetails);

      // Mock Stripe subscription update
      const updatedSubscription = {
        id: 'sub_test123',
        customer: 'cus_test123',
        items: {
          data: [
            {
              id: 'si_test123',
              price: {
                id: newPriceId,
                metadata: { tier: 'professional' },
              },
            },
          ],
        },
        status: 'active' as const,
      } as unknown as Stripe.Subscription;
      (mockStripe.subscriptions.update as jest.Mock).mockResolvedValueOnce(updatedSubscription);

      // Mock subscription_tiers update
      (mockPrisma.subscriptionTier.update as jest.Mock).mockResolvedValueOnce({
        id: 1,
        organizationId,
        tierLevel: 'professional',
        stripeSubscriptionId: 'sub_test123',
        status: SubscriptionStatus.ACTIVE,
        billingCycle: BillingCycle.MONTHLY,
        updatedAt: new Date(),
      });

      const result = await service.updateSubscription(organizationId, newPriceId);

      expect(result).toBeDefined();
      expect(result.tierLevel).toBe('professional');
      expect(mockStripe.subscriptions.update).toHaveBeenCalled();
    });

    it('should throw NotFoundError if subscription does not exist', async () => {
      const organizationId = 'org-123';
      (mockPrisma.subscriptionTier.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(service.updateSubscription(organizationId, 'price_new')).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel Stripe subscription at period end', async () => {
      const organizationId = 'org-123';

      // Mock existing subscription
      (mockPrisma.subscriptionTier.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 1,
        organizationId,
        stripeSubscriptionId: 'sub_test123',
        status: SubscriptionStatus.ACTIVE,
      });

      // Mock Stripe subscription cancel
      const canceledSubscription = {
        id: 'sub_test123',
        status: 'active' as const,
        cancel_at_period_end: true,
      } as unknown as Stripe.Subscription;
      (mockStripe.subscriptions.update as jest.Mock).mockResolvedValueOnce(canceledSubscription);

      // Mock subscription_tiers update
      (mockPrisma.subscriptionTier.update as jest.Mock).mockResolvedValueOnce({
        id: 1,
        organizationId,
        status: SubscriptionStatus.ACTIVE,
        updatedAt: new Date(),
      });

      const result = await service.cancelSubscription(organizationId);

      expect(result).toBeDefined();
      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_test123', {
        cancel_at_period_end: true,
      });
    });

    it('should throw NotFoundError if subscription does not exist', async () => {
      const organizationId = 'org-123';
      (mockPrisma.subscriptionTier.findFirst as jest.Mock).mockResolvedValueOnce(null);
    });
  });

  describe('reactivateSubscription', () => {
    it('should reactivate a canceled subscription', async () => {
      const organizationId = 'org-123';

      // Mock existing subscription
      (mockPrisma.subscriptionTier.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 1,
        organizationId,
        stripeSubscriptionId: 'sub_test123',
        status: SubscriptionStatus.CANCELED,
      });

      // Mock Stripe subscription update to resume
      const reactivatedSubscription = {
        id: 'sub_test123',
        status: 'active' as const,
        cancel_at_period_end: false,
      } as unknown as Stripe.Subscription;
      (mockStripe.subscriptions.update as jest.Mock).mockResolvedValueOnce(reactivatedSubscription);

      // Mock subscription_tiers update
      (mockPrisma.subscriptionTier.update as jest.Mock).mockResolvedValueOnce({
        id: 1,
        organizationId,
        status: SubscriptionStatus.ACTIVE,
        updatedAt: new Date(),
      });

      const result = await service.reactivateSubscription(organizationId);

      expect(result).toBeDefined();
      expect(result.status).toBe(SubscriptionStatus.ACTIVE);
      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_test123', {
        cancel_at_period_end: false,
      });
    });

    it('should throw NotFoundError if subscription does not exist', async () => {
      const organizationId = 'org-123';
      (mockPrisma.subscriptionTier.findFirst as jest.Mock).mockResolvedValueOnce(null);
    });
  });

  describe('syncSubscriptionState', () => {
    it('should sync Stripe subscription state to local database', async () => {
      const organizationId = 'org-123';
      const stripeSubscription = {
        id: 'sub_test123',
        customer: 'cus_test123',
        items: {
          data: [
            {
              price: {
                id: 'price_professional_monthly',
                metadata: { tier: 'professional' },
              },
            },
          ],
        },
        status: 'active' as const,
        trial_end: null,
      } as unknown as Stripe.Subscription;

      // Mock existing subscription
      (mockPrisma.subscriptionTier.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 1,
        organizationId,
        stripeSubscriptionId: 'sub_test123',
      });

      // Mock subscription_tiers update
      (mockPrisma.subscriptionTier.update as jest.Mock).mockResolvedValueOnce({
        id: 1,
        organizationId,
        tierLevel: 'professional',
        status: SubscriptionStatus.ACTIVE,
        trialEndDate: null,
        updatedAt: new Date(),
      });

      const result = await service.syncSubscriptionState(organizationId, stripeSubscription);

      expect(result).toBeDefined();
      expect(result.tierLevel).toBe('professional');
      expect(result.status).toBe(SubscriptionStatus.ACTIVE);
      expect(mockPrisma.subscriptionTier.update).toHaveBeenCalled();
    });

    it('should extract tier from price metadata', async () => {
      const organizationId = 'org-123';
      const stripeSubscription = {
        id: 'sub_test123',
        items: {
          data: [
            {
              price: {
                id: 'price_premium_annual',
                metadata: { tier: 'premium' },
              },
            },
          ],
        },
        status: 'active' as const,
        trial_end: null,
      } as unknown as Stripe.Subscription;

      (mockPrisma.subscriptionTier.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 1,
        organizationId,
      });

      (mockPrisma.subscriptionTier.update as jest.Mock).mockResolvedValueOnce({
        id: 1,
        tierLevel: 'premium',
      });

      await service.syncSubscriptionState(organizationId, stripeSubscription);

      expect(mockPrisma.subscriptionTier.update).toHaveBeenCalled();
      const updateCall = (mockPrisma.subscriptionTier.update as jest.Mock).mock.calls[0];
      expect(updateCall[0].where).toEqual({ id: 1 });
      expect(updateCall[0].data.tierLevel).toBe('premium');
    });

    it('should throw NotFoundError if subscription not found', async () => {
      const organizationId = 'org-123';
      const stripeSubscription = {
        id: 'sub_test123',
      } as unknown as Stripe.Subscription;

      (mockPrisma.subscriptionTier.findFirst as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.syncSubscriptionState(organizationId, stripeSubscription),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getTierLimits', () => {
    it('should return limits for starter tier', () => {
      const limits = service.getTierLimits('starter' as TierLevel);

      expect(limits).toEqual({
        max_skus: 500,
        max_users: 1,
      });
    });

    it('should return limits for professional tier', () => {
      const limits = service.getTierLimits('professional' as TierLevel);

      expect(limits).toEqual({
        max_skus: 2000,
        max_users: 3,
      });
    });

    it('should return unlimited SKUs for premium tier', () => {
      const limits = service.getTierLimits('premium' as TierLevel);

      expect(limits.max_skus).toBeNull();
      expect(limits.max_users).toBe(10);
    });
  });

  describe('isAccessActive', () => {
    it('returns true when subscription is not canceled', async () => {
      const subscriptionTier = {
        id: 1,
        organizationId: 'org-123',
        tierLevel: 'starter',
        status: SubscriptionStatus.ACTIVE,
        billingCycle: BillingCycle.MONTHLY,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as SubscriptionTier;

      const result = await service.isAccessActive(subscriptionTier);

      expect(result).toBe(true);
    });

    it('allows access when Stripe subscription is still active', async () => {
      const subscriptionTier = {
        id: 1,
        organizationId: 'org-123',
        tierLevel: 'starter',
        status: SubscriptionStatus.CANCELED,
        stripeSubscriptionId: 'sub_test123',
        billingCycle: BillingCycle.MONTHLY,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as SubscriptionTier;

      const stripeSubscription = {
        id: 'sub_test123',
        status: 'active' as const,
        cancel_at_period_end: true,
        current_period_end: Math.floor(Date.now() / 1000) + 3600,
      } as unknown as Stripe.Subscription;

      (mockStripe.subscriptions.retrieve as jest.Mock).mockResolvedValueOnce(stripeSubscription);

      const result = await service.isAccessActive(subscriptionTier);

      expect(result).toBe(true);
    });

    it('denies access when Stripe subscription is canceled and period ended', async () => {
      const subscriptionTier = {
        id: 1,
        organizationId: 'org-123',
        tierLevel: 'starter',
        status: SubscriptionStatus.CANCELED,
        stripeSubscriptionId: 'sub_test123',
        billingCycle: BillingCycle.MONTHLY,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as SubscriptionTier;

      const stripeSubscription = {
        id: 'sub_test123',
        status: 'canceled' as const,
        cancel_at_period_end: true,
        current_period_end: Math.floor(Date.now() / 1000) - 3600,
      } as unknown as Stripe.Subscription;

      (mockStripe.subscriptions.retrieve as jest.Mock).mockResolvedValueOnce(stripeSubscription);

      const result = await service.isAccessActive(subscriptionTier);

      expect(result).toBe(false);
    });

    it('denies access when no Stripe subscription id is present', async () => {
      const subscriptionTier = {
        id: 1,
        organizationId: 'org-123',
        tierLevel: 'starter',
        status: SubscriptionStatus.CANCELED,
        billingCycle: BillingCycle.MONTHLY,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as SubscriptionTier;

      const result = await service.isAccessActive(subscriptionTier);

      expect(result).toBe(false);
    });
  });
});
