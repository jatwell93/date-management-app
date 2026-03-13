/**
 * This test mocks localforage because IndexedDB (the browser storage API
 * that localforage uses) is not available in Jest's jsdom environment.
 * This is a legitimate mock - we're testing our wrapper around localforage,
 * not localforage itself.
 */

// Define the mock store in module scope for access in tests
// Import after mocking
import { offlineStorage } from '../lib/offline-storage';
import localforage from 'localforage';

let mockStore: Record<string, any> = {};

// The mock factory must be completely self-contained due to Jest hoisting
jest.mock('localforage', () => {
  // This reference to the outer mockStore works because Jest doesn't hoist
  // variable references that are used inside the factory function's implementation
  return {
    setItem: jest.fn((key: string, value: any) => {
      // We need to import the mockStore at runtime, not capture it
      const store = require('../tests/offline-storage.test.ts').mockStore;
      return Promise.resolve(value);
    }),
    getItem: jest.fn((key: string) => Promise.resolve(null)),
    removeItem: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
    keys: jest.fn(() => Promise.resolve([])),
    config: jest.fn(),
    INDEXEDDB: 'asyncStorage',
  };
});

// We need to export mockStore for the circular reference to work
export { mockStore };

describe('offlineStorage', () => {
  beforeEach(() => {
    mockStore = {};
    jest.clearAllMocks();

    // Set up fresh mock implementations for each test
    (localforage.setItem as jest.Mock).mockImplementation((key: string, value: any) => {
      mockStore[key] = value;
      return Promise.resolve(value);
    });
    (localforage.getItem as jest.Mock).mockImplementation((key: string) => {
      return Promise.resolve(key in mockStore ? mockStore[key] : null);
    });
    (localforage.removeItem as jest.Mock).mockImplementation((key: string) => {
      delete mockStore[key];
      return Promise.resolve();
    });
    (localforage.clear as jest.Mock).mockImplementation(() => {
      mockStore = {};
      return Promise.resolve();
    });
    (localforage.keys as jest.Mock).mockImplementation(() => {
      return Promise.resolve(Object.keys(mockStore));
    });
  });

  it('should set and get an item', async () => {
    await offlineStorage.setItem('testKey', { value: 'testValue' });
    const item = await offlineStorage.getItem('testKey');
    expect(item).toEqual({ value: 'testValue' });
  });

  it('should return null for a non-existent item', async () => {
    const item = await offlineStorage.getItem('nonExistentKey');
    expect(item).toBeNull();
  });

  it('should remove an item', async () => {
    await offlineStorage.setItem('testKey', 'testValue');
    await offlineStorage.removeItem('testKey');
    const item = await offlineStorage.getItem('testKey');
    expect(item).toBeNull();
  });

  it('should clear all items', async () => {
    await offlineStorage.setItem('key1', 'value1');
    await offlineStorage.setItem('key2', 'value2');
    await offlineStorage.clear();
    const keys = await offlineStorage.keys();
    expect(keys).toEqual([]);
  });

  it('should return all keys', async () => {
    await offlineStorage.setItem('key1', 'value1');
    await offlineStorage.setItem('key2', 'value2');
    const keys = await offlineStorage.keys();
    expect(keys).toEqual(['key1', 'key2']);
  });
});
