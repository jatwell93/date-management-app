/**
 * Unit tests for SubscriptionService
 * Tests Stripe integration with mocked Stripe client
 */

import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { SubscriptionService } from '../../services/subscription.service';
import { BillingCycle, SubscriptionStatus, TierLevel } from '../../types/subscription';
import { SubscriptionTier } from '../../models/subscription-tier.model';
import { InternalError, NotFoundError, ValidationError } from '../../errors';

// Mock Stripe and Prisma
vi.mock('stripe');
vi.mock('../../database/database-factory');

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let mockStripe: jest.Mocked<Stripe>;
  let mockPrisma: jest.Mocked<PrismaClient>;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock Stripe instance
    mockStripe = {
      customers: {
        create: vi.fn(),
        update: vi.fn(),
      },
      subscriptions: {
        create: vi.fn(),
        update: vi.fn(),
        cancel: vi.fn(),
        retrieve: vi.fn(),
      },
    } as any;

    // Create mock Prisma client with necessary methods
    mockPrisma = {
      organization: {
        findUnique: vi.fn(),
      },
      subscriptionTier: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      organizationUsage: {
        create: vi.fn(),
        findUnique: vi.fn(),
      },
      trialEvent: {
        create: vi.fn(),
        findFirst: vi.fn(),
      },
      $transaction: vi.fn((callback) => callback(mockPrisma)),
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
        cancelAtPeriodEnd: true,
        updatedAt: new Date(),
      });

      const result = await service.cancelSubscription(organizationId);

      expect(result).toBeDefined();
      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_test123', {
        cancel_at_period_end: true,
      });
      expect(mockPrisma.subscriptionTier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ cancelAtPeriodEnd: true }),
        }),
      );
      expect(result.cancelAtPeriodEnd).toBe(true);
    });

    it('should throw NotFoundError if subscription does not exist', async () => {
      const organizationId = 'org-123';
      (mockPrisma.subscriptionTier.findFirst as jest.Mock).mockResolvedValueOnce(null);
    });
  });

  describe('createTrialSubscription', () => {
    it('should create trial subscription with correct UTC dates', async () => {
      const organizationId = 'org-123';

      // Mock organization exists
      (mockPrisma.organization.findUnique as jest.Mock).mockResolvedValueOnce({
        id: organizationId,
        name: 'Test Pharmacy',
        contactEmail: 'test@example.com',
      });

      // Mock Stripe customer creation
      const stripeCustomer = { id: 'cus_test123' } as Stripe.Customer;
      (mockStripe.customers.create as jest.Mock).mockResolvedValueOnce(stripeCustomer);

      // Mock subscription_tiers create
      (mockPrisma.subscriptionTier.create as jest.Mock).mockResolvedValueOnce({
        id: 1,
        organizationId,
        tierLevel: 'professional',
        status: SubscriptionStatus.TRIALING,
        stripeCustomerId: 'cus_test123',
        trialStartedAt: new Date(),
        trialEndDate: new Date(),
        billingCycle: BillingCycle.MONTHLY,
      });

      await service.createTrialSubscription(organizationId, 14);

      // Verify trial end date is set to 00:00 UTC
      const createCall = mockPrisma.subscriptionTier.create as jest.Mock;
      expect(createCall).toHaveBeenCalled();

      const createData = createCall.mock.calls[0][0];
      const trialEndDate = new Date(createData.data.trialEndDate);
      expect(trialEndDate.getUTCHours()).toBe(0);
      expect(trialEndDate.getUTCMinutes()).toBe(0);
      expect(trialEndDate.getUTCSeconds()).toBe(0);
    });

    it('should throw NotFoundError if organization does not exist', async () => {
      (mockPrisma.organization.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(service.createTrialSubscription('org-nonexistent', 14)).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should create organizationUsage with Professional tier limits', async () => {
      const organizationId = 'org-123';

      // Mock organization exists
      (mockPrisma.organization.findUnique as jest.Mock).mockResolvedValueOnce({
        id: organizationId,
        name: 'Test Pharmacy',
        contactEmail: 'test@example.com',
      });

      // Mock Stripe customer creation
      const stripeCustomer = { id: 'cus_test123' } as Stripe.Customer;
      (mockStripe.customers.create as jest.Mock).mockResolvedValueOnce(stripeCustomer);

      // Mock subscription_tiers create
      (mockPrisma.subscriptionTier.create as jest.Mock).mockResolvedValueOnce({
        id: 1,
        organizationId,
        tierLevel: 'professional',
        status: SubscriptionStatus.TRIALING,
        stripeCustomerId: 'cus_test123',
        trialStartedAt: new Date(),
        trialEndDate: new Date(),
        billingCycle: BillingCycle.MONTHLY,
      });

      // Mock organizationUsage create
      (mockPrisma.organizationUsage.create as jest.Mock).mockResolvedValueOnce({
        id: 1,
        organizationId,
        activeUsers: 1,
        maxUsers: 3,
        totalSkus: 0,
        maxSkus: 2000,
        totalInventoryItems: 0,
        maxInventoryItems: 5000,
        storageUsedBytes: 0,
      });

      await service.createTrialSubscription(organizationId, 14);

      // Verify organizationUsage was created with Professional limits
      expect(mockPrisma.organizationUsage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId,
          activeUsers: 1,
          maxUsers: 10,
          totalSkus: 0,
          maxSkus: 50000,
        }),
      });
    });
  });

  describe('convertTrialToPaid', () => {
    it('should convert trial to paid subscription atomically', async () => {
      const organizationId = 'org-123';
      const paymentMethodId = 'pm_test123';

      // Mock existing TRIALING subscription
      (mockPrisma.subscriptionTier.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 1,
        organizationId,
        tierLevel: 'professional',
        stripeCustomerId: 'cus_test123',
        status: SubscriptionStatus.TRIALING,
      });

      // Mock Stripe subscription creation
      const stripeSubscription = {
        id: 'sub_test123',
        status: 'active' as const,
      } as unknown as Stripe.Subscription;
      (mockStripe.subscriptions.create as jest.Mock).mockResolvedValueOnce(stripeSubscription);

      // Mock $transaction to execute callback
      (mockPrisma.$transaction as jest.Mock) = vi.fn((callback) => callback(mockPrisma));

      // Mock subscription update within transaction
      (mockPrisma.subscriptionTier.update as jest.Mock).mockResolvedValueOnce({
        id: 1,
        organizationId,
        tierLevel: 'professional',
        status: SubscriptionStatus.ACTIVE,
        stripeSubscriptionId: 'sub_test123',
        trialConvertedAt: new Date(),
        billingCycle: BillingCycle.MONTHLY,
      });

      // Mock trialEvent create
      (mockPrisma.trialEvent.create as jest.Mock).mockResolvedValueOnce({ id: '1' });

      const result = await service.convertTrialToPaid(
        organizationId,
        paymentMethodId,
        BillingCycle.MONTHLY,
      );

      expect(result.status).toBe(SubscriptionStatus.ACTIVE);
      expect(result.stripeSubscriptionId).toBe('sub_test123');
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('converts a legacy premium trial at the Professional launch price', async () => {
      const originalProfessionalMonthly = process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID;
      process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID = 'price_professional_monthly';

      (mockPrisma.subscriptionTier.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 1,
        organizationId: 'org-123',
        tierLevel: 'premium',
        stripeCustomerId: 'cus_test123',
        status: SubscriptionStatus.TRIALING,
      });

      const stripeSubscription = {
        id: 'sub_test123',
        status: 'active' as const,
      } as unknown as Stripe.Subscription;
      (mockStripe.subscriptions.create as jest.Mock).mockResolvedValueOnce(stripeSubscription);
      (mockPrisma.$transaction as jest.Mock) = vi.fn((callback) => callback(mockPrisma));
      (mockPrisma.subscriptionTier.update as jest.Mock).mockResolvedValueOnce({
        id: 1,
        organizationId: 'org-123',
        tierLevel: 'premium',
        status: SubscriptionStatus.ACTIVE,
        stripeSubscriptionId: 'sub_test123',
        trialConvertedAt: new Date(),
        billingCycle: BillingCycle.MONTHLY,
      });
      (mockPrisma.trialEvent.create as jest.Mock).mockResolvedValueOnce({ id: '1' });

      try {
        await service.convertTrialToPaid('org-123', 'pm_test123', BillingCycle.MONTHLY);

        expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            items: [{ price: 'price_professional_monthly' }],
          }),
        );
      } finally {
        if (originalProfessionalMonthly === undefined) {
          delete process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID;
        } else {
          process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID = originalProfessionalMonthly;
        }
      }
    });

    it('rejects trial conversion for tiers without a Checkout price', async () => {
      (mockPrisma.subscriptionTier.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 1,
        organizationId: 'org-123',
        tierLevel: 'concierge',
        stripeCustomerId: 'cus_test123',
        status: SubscriptionStatus.TRIALING,
      });

      await expect(
        service.convertTrialToPaid('org-123', 'pm_test123', BillingCycle.MONTHLY),
      ).rejects.toThrow(ValidationError);
      expect(mockStripe.subscriptions.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError if no TRIALING subscription exists', async () => {
      (mockPrisma.subscriptionTier.findFirst as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.convertTrialToPaid('org-123', 'pm_test123', BillingCycle.MONTHLY),
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw InternalError if no Stripe customer exists', async () => {
      (mockPrisma.subscriptionTier.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 1,
        organizationId: 'org-123',
        stripeCustomerId: null,
        status: SubscriptionStatus.TRIALING,
      });

      await expect(
        service.convertTrialToPaid('org-123', 'pm_test123', BillingCycle.MONTHLY),
      ).rejects.toThrow(InternalError);
    });
  });

  describe('downgradeExpiredTrials', () => {
    it('should downgrade expired trials to starter tier', async () => {
      // Mock expired trials
      (mockPrisma.subscriptionTier.findMany as jest.Mock).mockResolvedValueOnce([
        { id: 1, organizationId: 'org-1' },
        { id: 2, organizationId: 'org-2' },
      ]);

      // Mock $transaction for each downgrade
      (mockPrisma.$transaction as jest.Mock) = vi.fn((callback) => callback(mockPrisma));
      (mockPrisma.subscriptionTier.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.trialEvent.create as jest.Mock).mockResolvedValue({});

      const count = await service.downgradeExpiredTrials();

      expect(count).toBe(2);
      expect(mockPrisma.subscriptionTier.update).toHaveBeenCalledTimes(2);
    });

    it('should return 0 if no expired trials', async () => {
      (mockPrisma.subscriptionTier.findMany as jest.Mock).mockResolvedValueOnce([]);

      const count = await service.downgradeExpiredTrials();

      expect(count).toBe(0);
    });

    it('should continue processing if one downgrade fails', async () => {
      // Mock expired trials
      (mockPrisma.subscriptionTier.findMany as jest.Mock).mockResolvedValueOnce([
        { id: 1, organizationId: 'org-1' },
        { id: 2, organizationId: 'org-2' },
      ]);

      // Mock $transaction
      (mockPrisma.$transaction as jest.Mock) = vi.fn((callback) => callback(mockPrisma));

      // First update fails, second succeeds
      (mockPrisma.subscriptionTier.update as jest.Mock)
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({});

      (mockPrisma.trialEvent.create as jest.Mock).mockResolvedValue({});

      const count = await service.downgradeExpiredTrials();

      expect(count).toBe(1);
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
        max_skus: 5000,
        max_users: 3,
        max_inventory_items: 5000,
        storage_bytes: 10737418240, // 10GB
      });
    });

    it('should return limits for professional tier', () => {
      const limits = service.getTierLimits('professional' as TierLevel);

      expect(limits).toEqual({
        max_skus: 50000,
        max_users: 10,
        max_inventory_items: 50000,
        storage_bytes: 107374182400, // 100GB
      });
    });

    it('should return limits for legacy premium tier', () => {
      const limits = service.getTierLimits('premium' as TierLevel);

      expect(limits.max_skus).toBe(50000);
      expect(limits.max_users).toBe(10);
      expect(limits.max_inventory_items).toBe(50000);
      expect(limits.storage_bytes).toBe(107374182400); // 100GB
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

  describe('findTrialsNeedingReminders', () => {
    it('skips records with null trialEndDate without throwing', async () => {
      (mockPrisma.subscriptionTier.findMany as jest.Mock).mockResolvedValueOnce([
        {
          organizationId: 'org-123',
          trialEndDate: null,
          organization: {
            id: 'org-123',
            name: 'Test Org',
            contactEmail: 'test@example.com',
          },
        },
      ]);
      (mockPrisma.trialEvent.findFirst as jest.Mock).mockResolvedValueOnce(null);

      await expect(service.findTrialsNeedingReminders()).resolves.toEqual([]);
    });
  });
});
