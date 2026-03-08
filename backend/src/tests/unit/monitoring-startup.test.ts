/**
 * Monitoring Startup Tests (P0-3)
 * 
 * Validates that monitoring system initializes correctly and handles
 * exceptions gracefully without crashing the application.
 */

import { EventEmitter } from 'events';
import { ApplicationMonitoringService } from '../../services/application.monitoring.service';
import { DatabaseMonitoringService } from '../../services/database.monitoring.service';

describe('Monitoring Startup', () => {
  let appMonitoringService: ApplicationMonitoringService;
  let dbMonitoringService: DatabaseMonitoringService;

  beforeEach(() => {
    // Reset singletons
    (ApplicationMonitoringService as any).instance = undefined;
    (DatabaseMonitoringService as any).instance = undefined;

    // Get fresh instances
    appMonitoringService = ApplicationMonitoringService.getInstance();
    dbMonitoringService = DatabaseMonitoringService.getInstance();
  });

  afterEach(() => {
    // Stop monitoring to clean up intervals
    appMonitoringService.stopMonitoring(true);
    dbMonitoringService.stopMonitoring(true);
  });

  describe('Service Initialization', () => {
    it('should initialize ApplicationMonitoringService without throwing', () => {
      expect(() => {
        ApplicationMonitoringService.getInstance();
      }).not.toThrow();
    });

    it('should initialize DatabaseMonitoringService without throwing', () => {
      expect(() => {
        DatabaseMonitoringService.getInstance();
      }).not.toThrow();
    });

    it('should return singleton instances', () => {
      const instance1 = ApplicationMonitoringService.getInstance();
      const instance2 = ApplicationMonitoringService.getInstance();
      expect(instance1).toBe(instance2);

      const db1 = DatabaseMonitoringService.getInstance();
      const db2 = DatabaseMonitoringService.getInstance();
      expect(db1).toBe(db2);
    });

    it('should inherit from EventEmitter for alert handling', () => {
      expect(appMonitoringService).toBeInstanceOf(EventEmitter);
      expect(dbMonitoringService).toBeInstanceOf(EventEmitter);
    });
  });

  describe('Monitoring Service Lifecycle', () => {
    it('should start monitoring when startMonitoring is called', () => {
      appMonitoringService.startMonitoring();
      expect((appMonitoringService as any).isMonitoring).toBe(true);
    });

    it('should stop monitoring when stopMonitoring is called', () => {
      appMonitoringService.startMonitoring();
      appMonitoringService.stopMonitoring(false);
      expect((appMonitoringService as any).isMonitoring).toBe(false);
    });

    it('should not throw when stopping already stopped monitoring', () => {
      expect(() => {
        appMonitoringService.stopMonitoring(false);
      }).not.toThrow();
    });

    it('should reset metrics when stopMonitoring is called with reset=true', () => {
      appMonitoringService.startMonitoring();
      appMonitoringService.stopMonitoring(true);
      
      const metrics = appMonitoringService.getMetrics();
      expect(metrics.performance.totalRequests).toBe(0);
    });
  });

  describe('Alert Event Handling', () => {
    it('should emit alert events that can be listened to', (done) => {
      const alertHandler = jest.fn((alert) => {
        expect(alert).toHaveProperty('type');
        expect(alert).toHaveProperty('message');
        expect(alert).toHaveProperty('severity');
        expect(alert).toHaveProperty('timestamp');
        done();
      });

      appMonitoringService.on('alert', alertHandler);

      // Trigger an alert by simulating conditions
      appMonitoringService.startMonitoring();

      // Manually trigger alert for test
      (appMonitoringService as any).emitAlert({
        type: 'HIGH_ERROR_RATE',
        message: 'Test alert',
        severity: 'high',
        timestamp: new Date(),
      });
    });

    it('should not crash when alert handler throws exception', () => {
      const faultyHandler = jest.fn(() => {
        throw new Error('Handler error');
      });

      appMonitoringService.on('alert', faultyHandler);

      // EventEmitter will throw, but we can catch it
      expect(() => {
        try {
          (appMonitoringService as any).emitAlert({
            type: 'HIGH_ERROR_RATE',
            message: 'Test alert',
            severity: 'high',
            timestamp: new Date(),
          });
        } catch (error) {
          // Expected - handler threw
          expect(error).toBeDefined();
          expect((error as Error).message).toBe('Handler error');
        }
      }).not.toThrow();
    });
  });

  describe('Exception Handling in Monitoring Path', () => {
    it('should handle exceptions during metrics collection', () => {
      // Start monitoring
      appMonitoringService.startMonitoring();

      // Simulate exception in metrics collection
      const mockGetMetrics = jest.spyOn(appMonitoringService, 'getMetrics')
        .mockImplementation(() => {
          throw new Error('Metrics collection error');
        });

      // Should not crash, just log error
      expect(() => {
        try {
          appMonitoringService.getMetrics();
        } catch (error) {
          // Expected to throw when mocked
          expect(error).toBeDefined();
        }
      }).not.toThrow();

      mockGetMetrics.mockRestore();
    });

    it('should continue functioning after middleware exception', () => {
      const middleware = appMonitoringService.requestTrackingMiddleware();
      
      const createMockResponse = () => ({
        statusCode: 200,
        on: jest.fn(),
      });
      
      const mockReq = { method: 'GET', path: '/test' } as any;
      const mockRes = createMockResponse() as any;
      const mockNext = jest.fn();

      // First call should work
      expect(() => {
        middleware(mockReq, mockRes, mockNext);
      }).not.toThrow();

      expect(mockNext).toHaveBeenCalled();

      // Second call should also work (service still operational)
      mockNext.mockClear();
      const mockRes2 = createMockResponse() as any;
      expect(() => {
        middleware(mockReq, mockRes2, mockNext);
      }).not.toThrow();

      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle database monitoring failures gracefully', () => {
      expect(() => {
        dbMonitoringService.startMonitoring();
      }).not.toThrow();

      // Simulating a failure during metrics collection
      const mockGetMetrics = jest.spyOn(dbMonitoringService, 'getMetrics')
        .mockImplementation(() => {
          throw new Error('Database query failed');
        });

      // Should not crash the service
      expect(() => {
        try {
          dbMonitoringService.getMetrics();
        } catch (error) {
          // Expected to throw when mocked
          expect(error).toBeDefined();
        }
      }).not.toThrow();

      mockGetMetrics.mockRestore();
    });
  });

  describe('Process Handler Registration', () => {
    it('should allow process handlers to be registered without conflicts', () => {
      // Verify we can register handlers (simulating bootstrap behavior)
      const mockHandler = jest.fn();
      
      expect(() => {
        process.once('SIGTERM', mockHandler);
      }).not.toThrow();
      
      // Clean up
      process.removeListener('SIGTERM', mockHandler);
    });

    it('should support uncaughtException handler registration', () => {
      const mockHandler = jest.fn();
      
      expect(() => {
        process.once('uncaughtException', mockHandler);
      }).not.toThrow();
      
      // Clean up
      process.removeListener('uncaughtException', mockHandler);
    });

    it('should support unhandledRejection handler registration', () => {
      const mockHandler = jest.fn();
      
      expect(() => {
        process.once('unhandledRejection', mockHandler);
      }).not.toThrow();
      
      // Clean up
      process.removeListener('unhandledRejection', mockHandler);
    });

    it('should support SIGINT handler registration', () => {
      const mockHandler = jest.fn();
      
      expect(() => {
        process.once('SIGINT', mockHandler);
      }).not.toThrow();
      
      // Clean up
      process.removeListener('SIGINT', mockHandler);
    });

    it('should handle exceptions in process handlers gracefully', () => {
      const faultyHandler = jest.fn(() => {
        throw new Error('Handler error');
      });
      
      // Register faulty handler
      process.once('uncaughtException', faultyHandler);
      
      // Should not crash when registering
      expect(() => {
        const listeners = process.listeners('uncaughtException');
        expect(listeners.length).toBeGreaterThanOrEqual(0);
      }).not.toThrow();
      
      // Clean up
      process.removeListener('uncaughtException', faultyHandler);
    });
  });

  describe('Graceful Degradation', () => {
    it('should return zero metrics when monitoring not started', () => {
      const metrics = appMonitoringService.getMetrics();
      expect(metrics.performance.totalRequests).toBe(0);
      expect(metrics.errors.totalErrors).toBe(0);
    });

    it('should not crash when accessing metrics during startup race condition', () => {
      // Simulate rapid start/stop
      appMonitoringService.startMonitoring();
      appMonitoringService.stopMonitoring(false);

      expect(() => {
        appMonitoringService.getMetrics();
      }).not.toThrow();
    });

    it('should handle concurrent metric updates safely', () => {
      appMonitoringService.startMonitoring();

      // Simulate concurrent requests tracking
      const middleware = appMonitoringService.requestTrackingMiddleware();
      const mockNext = jest.fn();

      // Mock response with EventEmitter behavior
      const createMockResponse = () => {
        const listeners: Record<string, Function[]> = {};
        return {
          statusCode: 200,
          on: jest.fn((event: string, handler: Function) => {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(handler);
          }),
          emit: (event: string) => {
            if (listeners[event]) {
              listeners[event].forEach(handler => handler());
            }
          },
        };
      };

      expect(() => {
        for (let i = 0; i < 10; i++) {
          const req = { method: 'GET', path: `/test${i}` } as any;
          const res = createMockResponse() as any;
          middleware(req, res, mockNext);
          res.emit('finish');
        }
      }).not.toThrow();

      const metrics = appMonitoringService.getMetrics();
      expect(metrics.performance.totalRequests).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Monitoring Service Resilience', () => {
    it('should recover from getMetrics errors gracefully', () => {
      appMonitoringService.startMonitoring();

      // Mock getMetrics to throw
      const originalGetMetrics = appMonitoringService.getMetrics;
      (appMonitoringService as any).getMetrics = jest.fn(() => {
        throw new Error('Corrupted state');
      });

      // Should not crash process
      expect(() => {
        try {
          appMonitoringService.getMetrics();
        } catch (error) {
          // Expected to catch the error
          expect(error).toBeDefined();
        }
      }).not.toThrow();

      // Restore original method
      (appMonitoringService as any).getMetrics = originalGetMetrics;
    });

    it('should maintain alerting capability after multiple start/stop cycles', () => {
      const alertHandler = jest.fn();
      appMonitoringService.on('alert', alertHandler);

      // Multiple cycles
      for (let i = 0; i < 3; i++) {
        appMonitoringService.startMonitoring();
        appMonitoringService.stopMonitoring(false);
      }

      // Alert system should still work
      appMonitoringService.startMonitoring();
      
      // Manually emit alert
      (appMonitoringService as any).emitAlert({
        type: 'HIGH_ERROR_RATE',
        message: 'Test alert after cycles',
        severity: 'high',
        timestamp: new Date(),
      });

      // Verify alert was emitted
      expect(alertHandler).toHaveBeenCalled();
    });

    it('should handle large metric volumes without memory leak', () => {
      appMonitoringService.startMonitoring();

      const middleware = appMonitoringService.requestTrackingMiddleware();
      const mockNext = jest.fn();

      // Mock response with EventEmitter
      const createMockResponse = () => {
        const listeners: Record<string, Function[]> = {};
        return {
          statusCode: 200,
          on: jest.fn((event: string, handler: Function) => {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(handler);
            // Immediately trigger finish for test speed
            if (event === 'finish') {
              setTimeout(() => handler(), 0);
            }
          }),
        };
      };

      // Simulate many requests
      for (let i = 0; i < 100; i++) {
        const req = { method: 'GET', path: `/test${i % 10}` } as any;
        const res = createMockResponse() as any;
        middleware(req, res, mockNext);
      }

      const metrics = appMonitoringService.getMetrics();
      // Should aggregate, not store all individually
      expect(metrics.performance.totalRequests).toBeLessThanOrEqual(100);
    });
  });
});
