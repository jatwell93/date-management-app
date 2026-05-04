import { SubscriptionRepository } from '../../repositories/subscription.repository';

describe('SubscriptionRepository', () => {
  let prisma: {
    subscriptionTier: {
      update: jest.Mock;
    };
  };
  let repository: SubscriptionRepository;

  beforeEach(() => {
    prisma = {
      subscriptionTier: {
        update: jest.fn(),
      },
    };
    repository = new SubscriptionRepository(prisma as never);
  });

  it('updates a subscription Stripe customer id', async () => {
    prisma.subscriptionTier.update.mockResolvedValue({ id: 1, stripeCustomerId: 'cus_123' });

    const result = await repository.updateStripeCustomerId(1, 'cus_123');

    expect(result).toEqual({ id: 1, stripeCustomerId: 'cus_123' });
    expect(prisma.subscriptionTier.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { stripeCustomerId: 'cus_123' },
    });
  });
});
