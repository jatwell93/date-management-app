import {
  DatabaseMonitoringService,
  DatabaseAlertType,
} from '../../services/database.monitoring.service';

describe('DatabaseMonitoringService', () => {
  let service: DatabaseMonitoringService;

  beforeEach(() => {
    (DatabaseMonitoringService as any).instance = undefined;
    service = DatabaseMonitoringService.getInstance();
  });

  afterEach(() => {
    service.stopMonitoring(true);
    jest.restoreAllMocks();
  });

  it('records query metrics and emits slow query alert', (done) => {
    service.initialize({
      slowQueryThreshold: 10,
      checkInterval: 60_000,
      enableAlerting: true,
    });

    service.on('alert', (alert) => {
      if (alert.type === DatabaseAlertType.SLOW_QUERY) {
        expect(alert.message).toContain('Slow query detected');
        done();
      }
    });

    service.recordQuery(50);
  });

  it('emits threshold alerts when collected metrics exceed limits', async () => {
    jest.spyOn(service as any, 'getConnectionPoolMetrics').mockResolvedValue({
      totalConnections: 10,
      activeConnections: 9,
      idleConnections: 1,
      maxConnections: 10,
      utilization: 95,
    });
    jest.spyOn(service as any, 'getPerformanceMetrics').mockResolvedValue({
      totalQueries: 10,
      slowQueries: 1,
      avgQueryTime: 20,
      lastQueryTime: 20,
    });
    jest.spyOn(service as any, 'getHealthMetrics').mockResolvedValue({
      uptime: 100,
      tableSizes: { products: 200 * 1024 * 1024 },
      rowCount: { products: 200_000 },
    });
    jest.spyOn(service as any, 'getDiskSpaceMetrics').mockResolvedValue({
      total: 100,
      used: 90,
      free: 10,
      available: 10,
      utilization: 90,
    });

    const alerts: string[] = [];
    service.on('alert', (alert) => alerts.push(alert.type));

    service.initialize({
      checkInterval: 60_000,
      enableAlerting: true,
      alertThresholds: {
        connectionPoolUtilization: 80,
        tableSizeThreshold: 50,
        rowCountThreshold: 100_000,
        diskSpaceUtilization: 80,
      },
    });

    await service.collectMetrics();

    expect(alerts).toContain(DatabaseAlertType.CONNECTION_POOL_EXHAUSTED);
    expect(alerts).toContain(DatabaseAlertType.TABLE_SIZE_THRESHOLD);
    expect(alerts).toContain(DatabaseAlertType.ROW_COUNT_THRESHOLD);
    expect(alerts).toContain(DatabaseAlertType.DISK_SPACE_LOW);
  });

  it('starts and stops monitoring lifecycle cleanly', () => {
    service.startMonitoring();
    expect((service as any).isMonitoring).toBe(true);

    service.stopMonitoring();
    expect((service as any).isMonitoring).toBe(false);
    expect((service as any).monitoringInterval).toBeUndefined();
  });

  it('returns early when startMonitoring is called while already running', () => {
    service.startMonitoring();
    const firstInterval = (service as any).monitoringInterval;

    service.startMonitoring();

    expect((service as any).isMonitoring).toBe(true);
    expect((service as any).monitoringInterval).toBe(firstInterval);
  });

  it('silently returns when stopMonitoring is called while not running', () => {
    expect(() => service.stopMonitoring(true)).not.toThrow();
    expect((service as any).isMonitoring).toBe(false);
  });
});
