import {
  ApplicationMonitoringService,
  ApplicationAlertType,
} from '../../services/application.monitoring.service';
import { Logger } from '../../utils/logger';

vi.mock('../../services/saas-metrics.service', () => ({
  SaasMetricsService: vi.fn().mockImplementation(function () {
    return {
      getSaasMetrics: vi.fn().mockResolvedValue(undefined),
      storeDailyMetrics: vi.fn().mockResolvedValue(undefined),
      recordWebhookMetrics: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

describe('ApplicationMonitoringService', () => {
  let service: ApplicationMonitoringService;

  beforeEach(() => {
    (ApplicationMonitoringService as any).instance = undefined;
    service = ApplicationMonitoringService.getInstance();
  });

  afterEach(() => {
    service.stopMonitoring(true);
  });

  it('records request metrics and computes error rate', () => {
    service.recordRequest({
      endpoint: 'GET /api/products',
      duration: 80,
      statusCode: 200,
      url: '/api/products',
    });
    service.recordRequest({
      endpoint: 'POST /api/products',
      duration: 90,
      statusCode: 500,
      url: '/api/products',
    });

    const metrics = service.getMetrics();
    expect(metrics.performance.totalRequests).toBe(2);
    expect(metrics.errors.totalErrors).toBe(1);
    expect(metrics.errors.errorRate).toBe(50);
  });

  it('emits a slow endpoint alert when duration exceeds threshold', async () => {
    // Vitest removed the `done` callback; await a Promise the listener resolves.
    await new Promise<void>((resolve) => {
      service.initialize({
        slowEndpointThreshold: 10,
        checkInterval: 60_000,
        enableAlerting: true,
      });

      service.on('alert', (alert) => {
        if (alert.type === ApplicationAlertType.SLOW_ENDPOINT) {
          expect(alert.message).toContain('Slow endpoint detected');
          resolve();
        }
      });

      service.recordRequest({
        endpoint: 'GET /api/reports/usage',
        duration: 50,
        statusCode: 200,
        url: '/api/reports/usage',
      });
    });
  });

  it('request tracking middleware records request and cleans up request map', () => {
    const middleware = service.requestTrackingMiddleware();
    const handlers: Record<string, () => void> = {};

    const req: any = { method: 'GET', url: '/api/products' };
    const res: any = {
      statusCode: 200,
      on: vi.fn((event: string, cb: () => void) => {
        handlers[event] = cb;
      }),
    };

    const next = vi.fn();
    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    handlers.finish();

    const metrics = service.getMetrics();
    expect(metrics.performance.totalRequests).toBeGreaterThanOrEqual(1);
    expect((service as any).requestStartTimes.size).toBe(0);
  });

  it('emits HIGH_ERROR_RATE alert when error threshold is exceeded', async () => {
    const alerts: string[] = [];
    service.on('alert', (alert) => alerts.push(alert.type));

    service.initialize({
      checkInterval: 60_000,
      enableAlerting: true,
      alertThresholds: {
        errorRate: 10,
        responseTimeThreshold: 10_000,
        requestPerMinuteThreshold: 10_000,
      },
    });

    service.recordRequest({
      endpoint: 'GET /api/products',
      duration: 5,
      statusCode: 500,
      url: '/api/products',
    });
    await service.collectMetrics();

    expect(alerts).toContain(ApplicationAlertType.HIGH_ERROR_RATE);
  });

  it('does not start background metrics collection before the first interval', () => {
    const saasMetricsService = {
      getSaasMetrics: vi.fn().mockResolvedValue(undefined),
      storeDailyMetrics: vi.fn().mockResolvedValue(undefined),
      recordWebhookMetrics: vi.fn().mockResolvedValue(undefined),
    };
    const debugSpy = vi.spyOn(Logger, 'debug').mockImplementation(() => undefined);

    service = new ApplicationMonitoringService(saasMetricsService as any);
    service.startMonitoring();
    service.stopMonitoring(true);

    expect(saasMetricsService.getSaasMetrics).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalledWith('Application metrics collected', expect.any(Object));

    debugSpy.mockRestore();
  });
});
