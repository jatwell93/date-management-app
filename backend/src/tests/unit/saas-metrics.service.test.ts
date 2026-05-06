import { SaasMetricsService } from '../../services/saas-metrics.service';

describe('SaasMetricsService', () => {
  it('records webhook metrics through the analytics repository', async () => {
    const analyticsRepo = {
      incrementWebhookMetrics: jest.fn().mockResolvedValue(undefined),
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
});
