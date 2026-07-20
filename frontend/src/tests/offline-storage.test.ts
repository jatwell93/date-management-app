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

// The mock factory must be completely self-contained due to hoisting.
vi.mock('localforage', () => {
  const localforage = {
    // Default no-op implementation; each test installs its own setItem
    // implementation against `mockStore` in beforeEach.
    setItem: vi.fn((_key: string, value: any) => Promise.resolve(value)),
    getItem: vi.fn((_key: string) => Promise.resolve(null)),
    removeItem: vi.fn(() => Promise.resolve()),
    clear: vi.fn(() => Promise.resolve()),
    keys: vi.fn(() => Promise.resolve([])),
    config: vi.fn(),
    INDEXEDDB: 'asyncStorage',
  };
  return { ...localforage, default: localforage };
});

// We need to export mockStore for the circular reference to work
export { mockStore };

describe('offlineStorage', () => {
  beforeEach(() => {
    mockStore = {};
    vi.clearAllMocks();

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
