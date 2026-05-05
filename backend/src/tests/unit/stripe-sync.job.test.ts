import Stripe from 'stripe';
import {
  runStripeSyncJob,
  startStripeSyncJob,
  stopStripeSyncJob,
} from '../../jobs/stripe-sync.job';
import { SubscriptionRepository } from '../../repositories/subscription.repository';

const mockStop = jest.fn();
const mockSchedule = jest.fn(() => ({ stop: mockStop }));
const mockResolve = jest.fn();
const mockGetDefaultDatabaseClient = jest.fn(() => {
  throw new Error('stripe sync job must resolve repositories through DI');
});

jest.mock('@prisma/client');
jest.mock('stripe', () => jest.fn().mockImplementation(() => mockStripeClient));
jest.mock('node-cron', () => ({
  __esModule: true,
  default: {
    schedule: (...args: unknown[]) => mockSchedule(...args),
  },
  schedule: (...args: unknown[]) => mockSchedule(...args),
}));
jest.mock('../../database/database-factory', () => ({
  getDefaultDatabaseClient: () => mockGetDefaultDatabaseClient(),
}));
jest.mock('../../di/container', () => ({
  getDiContainer: () => ({
    resolve: (...args: unknown[]) => mockResolve(...args),
  }),
}));
jest.mock('../../config/environment', () => ({
  envConfig: { STRIPE_SECRET_KEY: 'sk_test_123' },
}));

const mockStripeClient = {
  subscriptions: {
    list: jest.fn(),
  },
};

describe('StripeSyncJob', () => {
  let mockRepository: {
    findStripeLinkedSubscriptions: jest.Mock;
    updateByStripeSubscriptionId: jest.Mock;
  };
  let mockStripe: any;

  beforeEach(() => {
    mockRepository = {
      findStripeLinkedSubscriptions: jest.fn(),
      updateByStripeSubscriptionId: jest.fn(),
    };

    mockStripe = {
      subscriptions: {
        list: jest.fn(),
      },
    };

    jest.clearAllMocks();
    mockStripeClient.subscriptions.list.mockReset();
    mockResolve.mockReturnValue(mockRepository);
    stopStripeSyncJob();
  });

  it('syncs a diverged subscription tier from Stripe', async () => {
    // Local DB says 'starter', Stripe says 'professional'
    mockRepository.findStripeLinkedSubscriptions.mockResolvedValue([
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

    await runStripeSyncJob(
      mockRepository as unknown as SubscriptionRepository,
      mockStripe as Stripe,
    );

    expect(mockRepository.updateByStripeSubscriptionId).toHaveBeenCalledWith(
      'sub_abc',
      expect.objectContaining({ tierLevel: 'professional' }),
    );
  });

  it('does NOT update when local state matches Stripe', async () => {
    mockRepository.findStripeLinkedSubscriptions.mockResolvedValue([
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

    await runStripeSyncJob(
      mockRepository as unknown as SubscriptionRepository,
      mockStripe as Stripe,
    );

    expect(mockRepository.updateByStripeSubscriptionId).not.toHaveBeenCalled();
  });

  it('handles subscriptions missing from Stripe (log warning, do not delete)', async () => {
    mockRepository.findStripeLinkedSubscriptions.mockResolvedValue([
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
      runStripeSyncJob(mockRepository as unknown as SubscriptionRepository, mockStripe as Stripe),
    ).resolves.not.toThrow();

    // Should NOT delete or change status
    expect(mockRepository.updateByStripeSubscriptionId).not.toHaveBeenCalled();
  });

  it('handles Stripe API error gracefully without crashing', async () => {
    mockRepository.findStripeLinkedSubscriptions.mockResolvedValue([]);
    mockStripe.subscriptions.list.mockRejectedValue(new Error('Stripe API down'));

    await expect(
      runStripeSyncJob(mockRepository as unknown as SubscriptionRepository, mockStripe as Stripe),
    ).resolves.not.toThrow();
  });

  it('skips local records missing stripeSubscriptionId without throwing', async () => {
    mockRepository.findStripeLinkedSubscriptions.mockResolvedValue([
      {
        id: 1,
        organizationId: 'org-123',
        stripeSubscriptionId: null,
        tierLevel: 'starter',
        status: 'active',
      },
    ]);

    mockStripe.subscriptions.list.mockResolvedValue({
      data: [],
      has_more: false,
    });

    await expect(
      runStripeSyncJob(mockRepository as unknown as SubscriptionRepository, mockStripe as Stripe),
    ).resolves.not.toThrow();
    expect(mockRepository.updateByStripeSubscriptionId).not.toHaveBeenCalled();
  });

  it('handles paginated Stripe response with has_more=true', async () => {
    // Ensure there is at least one local subscription so the sync runs
    mockRepository.findStripeLinkedSubscriptions.mockResolvedValue([
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

    await runStripeSyncJob(
      mockRepository as unknown as SubscriptionRepository,
      mockStripe as Stripe,
    );

    // Should have called list twice (pagination)
    expect(mockStripe.subscriptions.list).toHaveBeenCalledTimes(2);
  });

  it('starts the cron job with a DI-resolved subscription repository', async () => {
    mockRepository.findStripeLinkedSubscriptions.mockResolvedValue([]);
    mockStripeClient.subscriptions.list.mockResolvedValue({ data: [], has_more: false });

    startStripeSyncJob();
    await mockSchedule.mock.calls[0][1]();

    expect(mockGetDefaultDatabaseClient).not.toHaveBeenCalled();
    expect(mockResolve).toHaveBeenCalledWith(SubscriptionRepository);
    expect(mockSchedule).toHaveBeenCalledWith('0 * * * *', expect.any(Function));
    expect(mockRepository.findStripeLinkedSubscriptions).toHaveBeenCalled();
  });
});
