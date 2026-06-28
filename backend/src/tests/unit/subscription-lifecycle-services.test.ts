import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { NotFoundError } from '../../errors';
import { SubscriptionTier } from '../../models/subscription-tier.model';
import { SubscriptionStatus, BillingCycle } from '../../types/subscription';
import { SubscriptionAccessService } from '../../services/subscription-access.service';
import { SubscriptionTrialLifecycleService } from '../../services/subscription-trial-lifecycle.service';
import { SubscriptionBillingLifecycleService } from '../../services/subscription-billing-lifecycle.service';

describe('subscription lifecycle services', () => {
  let prisma: jest.Mocked<PrismaClient>;
  let stripe: jest.Mocked<Stripe>;

  beforeEach(() => {
    vi.clearAllMocks();

    prisma = {
      organization: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      organizationUsage: {
        create: vi.fn(),
        update: vi.fn(),
        findUnique: vi.fn(),
      },
      subscriptionTier: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      trialEvent: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn((callback) => callback(prisma)),
    } as unknown as jest.Mocked<PrismaClient>;

    stripe = {
      customers: {
        create: vi.fn(),
      },
      subscriptions: {
        create: vi.fn(),
        retrieve: vi.fn(),
        update: vi.fn(),
      },
    } as unknown as jest.Mocked<Stripe>;
  });

  it('keeps access-check decisions isolated from subscription mutation workflows', async () => {
    const service = new SubscriptionAccessService(stripe);
    const subscriptionTier = {
      organizationId: 'org-123',
      status: SubscriptionStatus.CANCELED,
      stripeSubscriptionId: 'sub_123',
    } as SubscriptionTier;

    (stripe.subscriptions.retrieve as jest.Mock).mockResolvedValueOnce({
      status: 'canceled',
      cancel_at_period_end: true,
      current_period_end: Math.floor(Date.now() / 1000) + 3600,
    } as Stripe.Subscription);

    await expect(service.isAccessActive(subscriptionTier)).resolves.toBe(true);
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_123');
    expect(prisma.subscriptionTier.update).not.toHaveBeenCalled();
  });

  it('creates trial setup through the trial lifecycle service', async () => {
    const service = new SubscriptionTrialLifecycleService(prisma, stripe);

    (prisma.organization.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'org-123',
      name: 'Test Pharmacy',
      contactEmail: 'test@example.com',
    });
    (stripe.customers.create as jest.Mock).mockResolvedValueOnce({ id: 'cus_123' });
    (prisma.subscriptionTier.create as jest.Mock).mockResolvedValueOnce({});
    (prisma.organizationUsage.create as jest.Mock).mockResolvedValueOnce({});
    (prisma.trialEvent.create as jest.Mock).mockResolvedValueOnce({});

    await service.createTrialSubscription('org-123', 14);

    expect(prisma.subscriptionTier.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-123',
        status: SubscriptionStatus.TRIALING,
        stripeCustomerId: 'cus_123',
      }),
    });
    expect(prisma.organizationUsage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: 'org-123' }),
    });
    expect(prisma.trialEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-123',
        eventType: 'trial_started',
      }),
    });
  });

  it('throws NotFoundError from trial setup when the organization is missing', async () => {
    const service = new SubscriptionTrialLifecycleService(prisma, stripe);
    (prisma.organization.findUnique as jest.Mock).mockResolvedValueOnce(null);

    await expect(service.createTrialSubscription('missing-org')).rejects.toThrow(NotFoundError);
  });

  it('updates billing state through the billing lifecycle service', async () => {
    const service = new SubscriptionBillingLifecycleService(prisma, stripe);

    (prisma.subscriptionTier.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 1,
      organizationId: 'org-123',
      stripeSubscriptionId: 'sub_123',
    });
    (stripe.subscriptions.update as jest.Mock).mockResolvedValueOnce({
      status: 'active',
    } as Stripe.Subscription);
    (prisma.subscriptionTier.update as jest.Mock).mockResolvedValueOnce({
      id: 1,
      organizationId: 'org-123',
      tierLevel: 'starter',
      stripeSubscriptionId: 'sub_123',
      status: SubscriptionStatus.ACTIVE,
      billingCycle: BillingCycle.MONTHLY,
      trialEndDate: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.cancelSubscription('org-123');

    expect(result.status).toBe(SubscriptionStatus.ACTIVE);
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_123', {
      cancel_at_period_end: true,
    });
  });
});
