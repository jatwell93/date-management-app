import { SaasMetricsService } from '../../services/saas-metrics.service';

describe('SaasMetricsService', () => {
  it('records webhook metrics through the analytics repository', async () => {
    const analyticsRepo = {
      incrementWebhookMetrics: vi.fn().mockResolvedValue(undefined),
    };
    const service = new SaasMetricsService({} as never, undefined, analyticsRepo as never);

    await service.recordWebhookMetrics('checkout.session.completed', true);

    expect(analyticsRepo.incrementWebhookMetrics).toHaveBeenCalledTimes(1);
    expect(analyticsRepo.incrementWebhookMetrics).toHaveBeenCalledWith(
      'checkout.session.completed',
      true,
      expect.any(Date),
    );
  });

  it('calculates trial conversion rate from analytics repository trials', async () => {
    const analyticsRepo = {
      findTrialsEndedBetween: vi.fn().mockResolvedValue([
        { stripeSubscriptionId: 'sub_1', status: 'active' },
        { stripeSubscriptionId: null, status: 'trialing' },
      ]),
    };
    const service = new SaasMetricsService({} as never, undefined, analyticsRepo as never);

    const result = await service.calculateTrialConversionRate();

    expect(result).toBe(50);
    expect(analyticsRepo.findTrialsEndedBetween).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('calculates average revenue per user from repository revenue inputs', async () => {
    const analyticsRepo = {
      findActivePaidSubscriptionTierLevels: vi
        .fn()
        .mockResolvedValue([{ tierLevel: 'premium' }, { tierLevel: 'professional' }]),
      sumActiveOrganizationUsers: vi.fn().mockResolvedValue(4),
    };
    const service = new SaasMetricsService({} as never, undefined, analyticsRepo as never);

    const result = await service.calculateAvgRevenuePerUser();

    // premium ($99) + professional ($99) = $198 over 4 users
    expect(result).toBe(49.5);
    expect(analyticsRepo.findActivePaidSubscriptionTierLevels).toHaveBeenCalledTimes(1);
    expect(analyticsRepo.sumActiveOrganizationUsers).toHaveBeenCalledTimes(1);
  });

  it('gets tier distribution from the analytics repository', async () => {
    const analyticsRepo = {
      groupSubscriptionTiersByTierLevel: vi
        .fn()
        .mockResolvedValue([{ tierLevel: 'basic', _count: 2 }]),
    };
    const service = new SaasMetricsService({} as never, undefined, analyticsRepo as never);

    const result = await service.getTierDistribution();

    expect(result).toEqual({ basic: 2 });
    expect(analyticsRepo.groupSubscriptionTiersByTierLevel).toHaveBeenCalledTimes(1);
  });
});
