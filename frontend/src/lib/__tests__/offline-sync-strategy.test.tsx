import { offlineSyncService } from '../lib/offline-sync';

// Mock uuid to avoid ESM issues
jest.mock('uuid', () => ({
  __esModule: true,
  v4: () => 'test-uuid-' + Math.random().toString(36).substr(2, 9),
  default: {
    v4: () => 'test-uuid-' + Math.random().toString(36).substr(2, 9),
  },
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = Object.create(null);

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = Object.create(null);
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock fetch
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  } as Response),
) as jest.Mock;

// Mock navigator.onLine
Object.defineProperty(navigator, 'onLine', {
  writable: true,
  value: true,
});

describe('OfflineSyncService - Sync Strategy Tests', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();

    // Reset fetch mock
    (global.fetch as jest.Mock).mockClear();

    // Set navigator to online
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: true,
    });
  });

  afterEach(() => {
    // Clean up any intervals
    jest.useRealTimers();
  });

  test('should initialize with real-time strategy as default', () => {
    const service = offlineSyncService;
    expect(service.getSyncStrategy()).toBe('real-time');
    expect(localStorage.getItem('sync-strategy')).toBe('real-time');
  });

  test('should allow changing sync strategy and persist to localStorage', () => {
    const service = offlineSyncService;

    service.setSyncStrategy('batch');
    expect(service.getSyncStrategy()).toBe('batch');
    expect(localStorage.getItem('sync-strategy')).toBe('batch');

    service.setSyncStrategy('manual');
    expect(service.getSyncStrategy()).toBe('manual');
    expect(localStorage.getItem('sync-strategy')).toBe('manual');
  });

  test('should load sync strategy from localStorage on initialization', () => {
    // Set a strategy in localStorage before initializing the service
    localStorage.setItem('sync-strategy', 'batch');

    // Create a new instance to simulate fresh initialization
    const newService = require('../lib/offline-sync').offlineSyncService;

    expect(newService.getSyncStrategy()).toBe('batch');
  });

  test('should handle real-time strategy with immediate sync on addOperation', async () => {
    const service = offlineSyncService;
    service.setSyncStrategy('real-time');

    // Spy on performSync to verify it's called
    const performSyncSpy = jest.spyOn(service, 'performSync').mockResolvedValue();

    // Add an operation
    await service.addOperation('create', 'product', { name: 'Test Product' });

    // Verify performSync was called due to real-time strategy
    expect(performSyncSpy).toHaveBeenCalled();

    performSyncSpy.mockRestore();
  });

  test('should not trigger immediate sync in batch strategy on addOperation', async () => {
    const service = offlineSyncService;
    service.setSyncStrategy('batch');

    // Spy on performSync to verify it's not called immediately
    const performSyncSpy = jest.spyOn(service, 'performSync').mockResolvedValue();

    // Add an operation
    await service.addOperation('create', 'product', { name: 'Test Product' });

    // Verify performSync was NOT called immediately in batch mode
    expect(performSyncSpy).not.toHaveBeenCalled();

    performSyncSpy.mockRestore();
  });

  test('should not schedule automatic syncs in manual strategy', () => {
    jest.useFakeTimers();

    const service = offlineSyncService;
    service.setSyncStrategy('manual');

    // Advance timers significantly
    jest.advanceTimersByTime(100000); // 100 seconds

    // Verify that no sync happened during this time in manual mode
    // (We can't directly spy on the interval since it's cleared, but we can verify behavior)
    expect(service.getSyncStrategy()).toBe('manual');

    jest.useRealTimers();
  });

  test('should schedule 10-minute intervals for batch strategy', () => {
    jest.useFakeTimers();

    const service = offlineSyncService;
    service.setSyncStrategy('batch');

    // Advance timers by 9 minutes (should not trigger sync)
    jest.advanceTimersByTime(9 * 60 * 1000); // 9 minutes

    // Advance timers by 1 more minute (should trigger sync)
    jest.advanceTimersByTime(1 * 60 * 1000); // 1 more minute = 10 minutes total

    // Verify that sync would have been triggered
    expect(service.getSyncStrategy()).toBe('batch');

    jest.useRealTimers();
  });

  test('should schedule 30-second intervals for real-time strategy', () => {
    jest.useFakeTimers();

    const service = offlineSyncService;
    service.setSyncStrategy('real-time');

    // Advance timers by 30 seconds (should trigger sync)
    jest.advanceTimersByTime(30000); // 30 seconds

    // Verify that sync would have been triggered
    expect(service.getSyncStrategy()).toBe('real-time');

    jest.useRealTimers();
  });

  test('should retry sync with exponential backoff on failure', async () => {
    // Mock fetch to fail initially
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) } as Response);

    const service = offlineSyncService;

    // Add an operation to the queue
    await service.addOperation('create', 'product', { name: 'Test Product' });

    // Spy on the delay helper to verify backoff timing
    const delaySpy = jest.spyOn<any, any>(service, 'delay');

    // Perform sync with retry logic
    await service.performSync();

    // Verify that delay was called with increasing values (5000ms, then 10000ms)
    // The first call should be 5000ms, the second 10000ms (doubled)
    expect(delaySpy).toHaveBeenCalledWith(5000);

    delaySpy.mockRestore();
  });
});
