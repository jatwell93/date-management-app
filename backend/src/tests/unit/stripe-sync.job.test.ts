import { runStripeSyncJob } from '../../jobs/stripe-sync.job';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';

jest.mock('@prisma/client');
jest.mock('stripe');
jest.mock('../../database/database-factory');
jest.mock('../../config/environment', () => ({
  envConfig: { STRIPE_SECRET_KEY: 'sk_test_123' },
}));

describe('StripeSyncJob', () => {
  let mockPrisma: any;
  let mockStripe: any;

  beforeEach(() => {
    mockPrisma = {
      subscriptionTier: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      $disconnect: jest.fn(),
    };

    mockStripe = {
      subscriptions: {
        list: jest.fn(),
      },
    };

    jest.clearAllMocks();
  });

  it('syncs a diverged subscription tier from Stripe', async () => {
    // Local DB says 'starter', Stripe says 'professional'
    mockPrisma.subscriptionTier.findMany.mockResolvedValue([
      {
        id: 1,
        organizationId: 'org-123',
        stripeSubscriptionId: 'sub_abc',
        tierLevel: 'starter',
        status: 'active',
      },
    ]);

    mockStripe.subscriptions.list.mockResolvedValue({
      data: [
        {
          id: 'sub_abc',
          status: 'active',
          items: {
            data: [{ price: { metadata: { tier: 'professional' } } }],
          },
        },
      ],
      has_more: false,
    });

    await runStripeSyncJob(mockPrisma as unknown as PrismaClient, mockStripe as unknown as Stripe);

    expect(mockPrisma.subscriptionTier.updateMany).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: 'sub_abc' },
      data: expect.objectContaining({ tierLevel: 'professional' }),
    });
  });

  it('does NOT update when local state matches Stripe', async () => {
    mockPrisma.subscriptionTier.findMany.mockResolvedValue([
      {
        id: 1,
        organizationId: 'org-123',
        stripeSubscriptionId: 'sub_abc',
        tierLevel: 'professional',
        status: 'active',
      },
    ]);

    mockStripe.subscriptions.list.mockResolvedValue({
      data: [
        {
          id: 'sub_abc',
          status: 'active',
          items: {
            data: [{ price: { metadata: { tier: 'professional' } } }],
          },
        },
      ],
      has_more: false,
    });

    await runStripeSyncJob(mockPrisma as unknown as PrismaClient, mockStripe as unknown as Stripe);

    expect(mockPrisma.subscriptionTier.updateMany).not.toHaveBeenCalled();
  });

  it('handles subscriptions missing from Stripe (log warning, do not delete)', async () => {
    mockPrisma.subscriptionTier.findMany.mockResolvedValue([
      {
        id: 1,
        organizationId: 'org-123',
        stripeSubscriptionId: 'sub_missing',
        tierLevel: 'professional',
        status: 'active',
      },
    ]);

    // Stripe returns no subscriptions
    mockStripe.subscriptions.list.mockResolvedValue({
      data: [],
      has_more: false,
    });

    // Should not throw
    await expect(
      runStripeSyncJob(mockPrisma as unknown as PrismaClient, mockStripe as unknown as Stripe),
    ).resolves.not.toThrow();

    // Should NOT delete or change status
    expect(mockPrisma.subscriptionTier.updateMany).not.toHaveBeenCalled();
  });

  it('handles Stripe API error gracefully without crashing', async () => {
    mockPrisma.subscriptionTier.findMany.mockResolvedValue([]);
    mockStripe.subscriptions.list.mockRejectedValue(new Error('Stripe API down'));

    await expect(
      runStripeSyncJob(mockPrisma as unknown as PrismaClient, mockStripe as unknown as Stripe),
    ).resolves.not.toThrow();
  });

  it('handles paginated Stripe response with has_more=true', async () => {
    // Ensure there is at least one local subscription so the sync runs
    mockPrisma.subscriptionTier.findMany.mockResolvedValue([
      {
        id: 1,
        organizationId: 'org-123',
        stripeSubscriptionId: 'sub_page1',
        tierLevel: 'starter',
        status: 'active',
      },
    ]);

    // First page returns has_more=true, second page has_more=false
    mockStripe.subscriptions.list
      .mockResolvedValueOnce({
        data: [
          {
            id: 'sub_page1',
            status: 'active',
            items: { data: [{ price: { metadata: { tier: 'starter' } } }] },
          },
        ],
        has_more: true,
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'sub_page2',
            status: 'active',
            items: { data: [{ price: { metadata: { tier: 'starter' } } }] },
          },
        ],
        has_more: false,
      });

    await runStripeSyncJob(mockPrisma as unknown as PrismaClient, mockStripe as unknown as Stripe);

    // Should have called list twice (pagination)
    expect(mockStripe.subscriptions.list).toHaveBeenCalledTimes(2);
  });
});
