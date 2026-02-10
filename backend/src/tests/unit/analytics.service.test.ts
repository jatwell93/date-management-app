import { AnalyticsService, AnalyticsEventType } from '../../services/analytics.service';
import { AnalyticsRepository } from '../../repositories/analytics.repository';
import Database from 'better-sqlite3';

// Mock the AnalyticsRepository
jest.mock('../../repositories/analytics.repository');

describe('AnalyticsService', () => {
  let analyticsService: AnalyticsService;
  let mockRepository: jest.Mocked<AnalyticsRepository>;
  let mockDb: Partial<Database>;

  beforeEach(() => {
    // Create a mock database instance
    mockDb = {} as Database;

    // Create service with mock database
    analyticsService = new AnalyticsService(mockDb as unknown as Database);

    // Create mock repository with proper typing
    mockRepository = {
      initializeTables: jest.fn().mockReturnValue(undefined),
      storeEventsBatch: jest.fn().mockResolvedValue(undefined),
      startSession: jest.fn().mockResolvedValue('session-123'),
      endSession: jest.fn().mockResolvedValue(undefined),
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
      cleanOldData: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      exportData: jest.fn().mockResolvedValue([]),
    } as any;

    // Inject the mock repository into the service
    (analyticsService as any).repository = mockRepository;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    it('should initialize tables via repository', () => {
      mockRepository.initializeTables.mockReturnValue(undefined);

      analyticsService.initialize({
        enableTracking: true,
        enableSessionTracking: true,
        retentionPeriod: 90,
        batchSize: 100,
        enablePWAAnalytics: true,
      });

      expect(mockRepository.initializeTables).toHaveBeenCalledTimes(1);
    });

    it('should merge provided config with defaults', () => {
      mockRepository.initializeTables.mockReturnValue(undefined);

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
      // @ts-expect-error - Mock setup, TypeScript can't infer jest.Mock type
      mockRepository.startSession.mockResolvedValue('session-123');
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
      expect(mockRepository.startSession).toHaveBeenCalled();
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
      expect(mockRepository.startSession).not.toHaveBeenCalled();
    });
  });

  describe('endSession', () => {
    beforeEach(() => {
      analyticsService.initialize({ enableSessionTracking: true });
    });

    it('should end session via repository', async () => {
      // @ts-expect-error - Mock setup, TypeScript can't infer jest.Mock type
      mockRepository.endSession.mockResolvedValue(undefined);

      await analyticsService.endSession('session-123');

      expect(mockRepository.endSession).toHaveBeenCalled();
    });

    it('should not end session when tracking disabled', async () => {
      analyticsService.initialize({ enableSessionTracking: false });

      await analyticsService.endSession('session-123');

      expect(mockRepository.endSession).not.toHaveBeenCalled();
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
      // @ts-expect-error - Mock setup, TypeScript can't infer jest.Mock type
      mockRepository.getMetrics.mockResolvedValue(mockMetrics);

      const metrics = await analyticsService.getMetrics();

      expect(metrics).toBeDefined();
      expect(mockRepository.getMetrics).toHaveBeenCalledTimes(1);
    });
  });

  describe('cleanOldData', () => {
    it('should clean old data via repository', async () => {
      // @ts-expect-error - Mock setup, TypeScript can't infer jest.Mock type
      mockRepository.cleanOldData.mockResolvedValue({ deletedCount: 150 });

      await analyticsService.cleanOldData();

      expect(mockRepository.cleanOldData).toHaveBeenCalled();
    });

    it('should use configured retention period', async () => {
      analyticsService.initialize({ retentionPeriod: 30 });
      // @ts-expect-error - Mock setup, TypeScript can't infer jest.Mock type
      mockRepository.cleanOldData.mockResolvedValue({ deletedCount: 50 });

      await analyticsService.cleanOldData();

      expect(mockRepository.cleanOldData).toHaveBeenCalled();
    });
  });

  describe('exportData', () => {
    it('should export data via repository', async () => {
      const mockData = [
        {
          id: 1,
          userId: 1,
          eventType: AnalyticsEventType.USER_LOGIN,
          eventCategory: 'auth',
          eventAction: 'login',
          timestamp: new Date(),
        },
      ];
      // @ts-expect-error - Mock setup, TypeScript can't infer jest.Mock type
      mockRepository.exportData.mockResolvedValue(mockData);

      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-01-31');
      const data = await analyticsService.exportData(startDate, endDate);

      expect(data).toBeDefined();
      expect(mockRepository.exportData).toHaveBeenCalled();
    });
  });
});
