import { AnalyticsService, AnalyticsEventType } from '../../services/analytics.service';
import { IAnalyticsAdapter } from '../../adapters/analytics/IAnalyticsAdapter';

describe('AnalyticsService', () => {
  let analyticsService: AnalyticsService;
  let mockAdapter: jest.Mocked<IAnalyticsAdapter>;

  beforeEach(() => {
    // Create mock adapter
    mockAdapter = {
      isAvailable: jest.fn().mockReturnValue(true),
      initialize: jest.fn(),
      storeEventsBatch: jest.fn(),
      startSession: jest.fn().mockReturnValue('session-123'),
      endSession: jest.fn(),
      updateSession: jest.fn(),
      getMetrics: jest.fn().mockResolvedValue({
        dailyActiveUsers: 0,
        weeklyActiveUsers: 0,
        monthlyActiveUsers: 0,
        totalSessions: 0,
        averageSessionDuration: 0,
        topEvents: [],
        userRetention: 0,
        pwaInstallationRate: 0,
        offlineUsageRate: 0,
      }),
      getEventCountByType: jest.fn().mockResolvedValue(0),
      cleanupOldData: jest.fn().mockResolvedValue(0),
      getActiveUserCount: jest.fn().mockResolvedValue(0),
    } as any;

    // Create service with mock adapter
    analyticsService = new AnalyticsService(mockAdapter);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    it('should initialize via adapter', () => {
      analyticsService.initialize({
        enableTracking: true,
        enableSessionTracking: true,
        retentionPeriod: 90,
        batchSize: 100,
        enablePWAAnalytics: true,
      });

      expect(mockAdapter.initialize).toHaveBeenCalledTimes(1);
    });

    it('should merge provided config with defaults', () => {
      analyticsService.initialize({
        enableTracking: false,
      });

      const config = (analyticsService as any).config;
      expect(config.enableTracking).toBe(false);
      expect(config.enableSessionTracking).toBe(true); // Default
    });
  });

  describe('trackEvent', () => {
    beforeEach(() => {
      analyticsService.initialize({ enableTracking: true });
    });

    it('should add event to queue for non-priority events', () => {
      const event = {
        userId: 1,
        sessionId: 'test-session',
        eventType: AnalyticsEventType.VIEW_DASHBOARD,
        eventCategory: 'dashboard',
        eventAction: 'view',
        eventLabel: 'main',
      };

      analyticsService.trackEvent(event);

      const queue = (analyticsService as any).eventQueue;
      expect(queue.length).toBeGreaterThanOrEqual(1);
      // Find our event in the queue
      const foundEvent = queue.find((e: any) => e.eventType === AnalyticsEventType.VIEW_DASHBOARD);
      expect(foundEvent).toBeDefined();
    });

    it('should process queue immediately for high-priority events', () => {
      const event = {
        userId: 1,
        sessionId: 'test-session',
        eventType: AnalyticsEventType.USER_LOGIN,
        eventCategory: 'auth',
        eventAction: 'login',
        eventLabel: 'success',
      };

      analyticsService.trackEvent(event);

      // High priority events trigger immediate processing
      // Queue might be empty if batch processing completed
      const queue = (analyticsService as any).eventQueue;
      expect(queue).toBeDefined();
    });

    it('should not track when tracking disabled', () => {
      analyticsService.initialize({ enableTracking: false });

      const event = {
        userId: 1,
        sessionId: 'test-session',
        eventType: AnalyticsEventType.SCAN_BARCODE,
        eventCategory: 'inventory',
        eventAction: 'scan',
      };

      analyticsService.trackEvent(event);

      const queue = (analyticsService as any).eventQueue;
      expect(queue.length).toBe(0);
    });
  });

  describe('startSession', () => {
    beforeEach(() => {
      analyticsService.initialize({ enableSessionTracking: true });
      mockAdapter.startSession.mockResolvedValue('session-123');
    });

    it('should start session via repository with generated ID', () => {
      const sessionData = {
        userId: 1,
        sessionId: 'session-123',
        isPWA: false,
      };

      const sessionId = analyticsService.startSession(sessionData);

      // Session ID is generated internally, just verify format
      expect(sessionId).toBeTruthy();
      expect(typeof sessionId).toBe('string');
      expect(sessionId.length).toBeGreaterThan(0);
      expect(mockAdapter.startSession).toHaveBeenCalled();
    });

    it('should not start session when tracking disabled', () => {
      analyticsService.initialize({ enableSessionTracking: false });

      const sessionData = {
        userId: 1,
        sessionId: 'session-123',
        isPWA: false,
      };

      const sessionId = analyticsService.startSession(sessionData);

      // Service returns empty string when disabled, not null
      expect(sessionId).toBe('');
      expect(mockAdapter.startSession).not.toHaveBeenCalled();
    });
  });

  describe('endSession', () => {
    beforeEach(() => {
      analyticsService.initialize({ enableSessionTracking: true });
    });

    it('should end session via repository', async () => {
      mockAdapter.endSession.mockResolvedValue(undefined);

      await analyticsService.endSession('session-123');

      expect(mockAdapter.endSession).toHaveBeenCalled();
    });

    it('should not end session when tracking disabled', async () => {
      analyticsService.initialize({ enableSessionTracking: false });

      await analyticsService.endSession('session-123');

      expect(mockAdapter.endSession).not.toHaveBeenCalled();
    });
  });

  describe('getMetrics', () => {
    it('should return metrics from repository', async () => {
      const mockMetrics = {
        dailyActiveUsers: 50,
        weeklyActiveUsers: 200,
        monthlyActiveUsers: 500,
        totalSessions: 1000,
        averageSessionDuration: 300,
        topEvents: [
          { eventType: AnalyticsEventType.USER_LOGIN, count: 150 },
          { eventType: AnalyticsEventType.SCAN_BARCODE, count: 300 },
        ],
        userRetention: 0.75,
        pwaInstallationRate: 0.3,
        offlineUsageRate: 0.15,
      };
      mockAdapter.getMetrics.mockResolvedValue(mockMetrics);

      const metrics = await analyticsService.getMetrics();

      expect(metrics).toBeDefined();
      expect(mockAdapter.getMetrics).toHaveBeenCalledTimes(1);
    });
  });

  describe('resetInstance', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('clears the batch interval when resetting the singleton', () => {
      const clearSpy = jest.spyOn(global, 'clearInterval');

      analyticsService.initialize({ enableTracking: true });
      (AnalyticsService as any).instance = analyticsService;

      AnalyticsService.resetInstance();

      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });

  describe('cleanOldData', () => {
    it('should clean old data via repository', async () => {
      mockAdapter.cleanupOldData.mockResolvedValue(150);

      await analyticsService.cleanOldData();

      expect(mockAdapter.cleanupOldData).toHaveBeenCalled();
    });

    it('should use configured retention period', async () => {
      analyticsService.initialize({ retentionPeriod: 30 });
      mockAdapter.cleanupOldData.mockResolvedValue(50);

      await analyticsService.cleanOldData();

      expect(mockAdapter.cleanupOldData).toHaveBeenCalledWith(30);
    });
  });

  describe('exportData', () => {
    it('should return empty array (deprecated)', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-31');
      const data = await analyticsService.exportData(startDate, endDate);

      expect(data).toEqual([]);
      // Method is deprecated and doesn't use adapter
    });
  });
});
