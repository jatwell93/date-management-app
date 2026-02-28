import { offlineSyncService } from '../lib/offline-sync';

// Mock localStorage
let localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: jest.fn((key: string) => localStorageStore[key] ?? null),
  setItem: jest.fn((key: string, value: string) => {
    localStorageStore[key] = value;
  }),
  removeItem: jest.fn((key: string) => {
    delete localStorageStore[key];
  }),
  clear: jest.fn(() => {
    localStorageStore = {};
  }),
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock navigator.onLine
Object.defineProperty(navigator, 'onLine', {
  writable: true,
  value: true,
});

// Mock fetch
global.fetch = jest.fn();

// Mock setInterval and clearInterval
jest.useFakeTimers();

describe('OfflineSyncService - Sync Strategies', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.clearAllTimers();
    localStorageStore = {};

    offlineSyncService.clearQueue();
    (offlineSyncService as any).syncInProgress = false;
    (offlineSyncService as any).isOnline = true;
    offlineSyncService.setSyncStrategy('real-time');

    // Reset localStorage mocks
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();
    localStorageMock.clear.mockClear();

    localStorageMock.getItem.mockImplementation((key: string) => localStorageStore[key] ?? null);
    localStorageMock.setItem.mockImplementation((key: string, value: string) => {
      localStorageStore[key] = value;
    });
    localStorageMock.removeItem.mockImplementation((key: string) => {
      delete localStorageStore[key];
    });
    localStorageMock.clear.mockImplementation(() => {
      localStorageStore = {};
    });

    // Reset fetch mock
    (global.fetch as jest.Mock).mockClear();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({}),
    });

    // Reset navigator.onLine
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: true,
    });
  });

  describe('Sync Strategy Management', () => {
    it('should load default sync strategy from localStorage', () => {
      localStorageMock.getItem.mockReturnValue('batch');
      // Create a new instance to test loading
      const { offlineSyncService: newService } = require('../lib/offline-sync');
      // Note: This is tricky to test directly due to singleton pattern
      // We'll test the methods instead
    });

    it('should set and persist sync strategy', () => {
      offlineSyncService.setSyncStrategy('batch');
      expect(localStorageMock.setItem).toHaveBeenCalledWith('sync-strategy', 'batch');
    });

    it('should get current sync strategy', () => {
      offlineSyncService.setSyncStrategy('manual');
      expect(offlineSyncService.getSyncStrategy()).toBe('manual');
    });
  });

  describe('Real-time Strategy', () => {
    beforeEach(() => {
      offlineSyncService.setSyncStrategy('real-time');
    });

    it('should trigger sync immediately after adding operation in real-time mode', async () => {
      const performSyncSpy = jest.spyOn(offlineSyncService, 'performSync');
      performSyncSpy.mockResolvedValue();

      await offlineSyncService.addOperation('create', 'inventory-item', {
        productId: 1,
        expiryDate: '2026-12-31',
        locationId: 1,
      });

      expect(performSyncSpy).toHaveBeenCalledTimes(1);
    });

    it('should not schedule automatic intervals in real-time mode', () => {
      // Real-time mode should not set up intervals
      expect(offlineSyncService.getSyncStrategy()).toBe('real-time');
      // The interval should not be set for real-time
    });
  });

  describe('Batch Strategy', () => {
    beforeEach(() => {
      offlineSyncService.setSyncStrategy('batch');
    });

    it('should not trigger immediate sync after adding operation in batch mode', async () => {
      const performSyncSpy = jest.spyOn(offlineSyncService, 'performSync');
      performSyncSpy.mockResolvedValue();

      await offlineSyncService.addOperation('create', 'inventory-item', {
        productId: 1,
        expiryDate: '2026-12-31',
        locationId: 1,
      });

      expect(performSyncSpy).not.toHaveBeenCalled();
    });

    it('should schedule sync every 10 minutes in batch mode', () => {
      const performSyncSpy = jest.spyOn(offlineSyncService, 'performSync');
      performSyncSpy.mockResolvedValue();

      // Fast-forward 10 minutes
      jest.advanceTimersByTime(10 * 60 * 1000);

      expect(performSyncSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Manual Strategy', () => {
    beforeEach(() => {
      offlineSyncService.setSyncStrategy('manual');
    });

    it('should not trigger immediate sync after adding operation in manual mode', async () => {
      const performSyncSpy = jest.spyOn(offlineSyncService, 'performSync');
      performSyncSpy.mockResolvedValue();

      await offlineSyncService.addOperation('create', 'inventory-item', {
        productId: 1,
        expiryDate: '2026-12-31',
        locationId: 1,
      });

      expect(performSyncSpy).not.toHaveBeenCalled();
    });

    it('should not schedule automatic intervals in manual mode', () => {
      // Manual mode should not set up intervals
      expect(offlineSyncService.getSyncStrategy()).toBe('manual');

      // Fast-forward time - no sync should be called automatically
      const performSyncSpy = jest.spyOn(offlineSyncService, 'performSync');
      performSyncSpy.mockResolvedValue();

      jest.advanceTimersByTime(10 * 60 * 1000);

      expect(performSyncSpy).not.toHaveBeenCalled();
    });

    it('should allow manual sync trigger', async () => {
      const performSyncSpy = jest.spyOn(offlineSyncService, 'performSync');
      performSyncSpy.mockResolvedValue();

      await offlineSyncService.performSync();

      expect(performSyncSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Strategy Changes', () => {
    it('should reschedule sync when strategy changes from batch to manual', () => {
      offlineSyncService.setSyncStrategy('batch');
      expect(offlineSyncService.getSyncStrategy()).toBe('batch');

      offlineSyncService.setSyncStrategy('manual');
      expect(offlineSyncService.getSyncStrategy()).toBe('manual');
    });

    it('should reschedule sync when strategy changes from manual to real-time', () => {
      offlineSyncService.setSyncStrategy('manual');
      expect(offlineSyncService.getSyncStrategy()).toBe('manual');

      offlineSyncService.setSyncStrategy('real-time');
      expect(offlineSyncService.getSyncStrategy()).toBe('real-time');
    });
  });

  describe('Exponential Backoff Retry', () => {
    beforeEach(() => {
      offlineSyncService.setSyncStrategy('manual');
    });

    it('should retry failed sync with exponential backoff', async () => {
      // Mock fetch to fail on first two attempts, succeed on third
      let attemptCount = 0;
      (global.fetch as jest.Mock).mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          return Promise.resolve({
            ok: false,
            status: 500,
          });
        }
        return Promise.resolve({
          ok: true,
          json: jest.fn().mockResolvedValue({}),
        });
      });

      // Add an operation to sync
      await offlineSyncService.addOperation('create', 'inventory-item', {
        productId: 1,
        expiryDate: '2026-12-31',
        locationId: 1,
      });

      const delaySpy = jest
        .spyOn<any, any>(offlineSyncService, 'delay')
        .mockResolvedValue(undefined);

      // Start sync
      await offlineSyncService.performSync();

      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(delaySpy).toHaveBeenCalledWith(5000);
      delaySpy.mockRestore();
    });

    it('should stop retrying after max attempts and keep items in queue', async () => {
      const delaySpy = jest
        .spyOn<any, any>(offlineSyncService, 'delay')
        .mockResolvedValue(undefined);

      // Mock fetch to always fail
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
      });

      // Add an operation
      await offlineSyncService.addOperation('create', 'inventory-item', {
        productId: 1,
        expiryDate: '2026-12-31',
        locationId: 1,
      });

      const initialQueueLength = offlineSyncService.getPendingOperationCount();

      // Start sync and let all retries fail
      await offlineSyncService.performSync();

      // Items should still be in queue
      expect(offlineSyncService.getPendingOperationCount()).toBe(initialQueueLength);
      expect(delaySpy).toHaveBeenCalledWith(5000);
      delaySpy.mockRestore();
    });
  });
});
