import { synchronizeOfflineData } from '../lib/sync-manager';
import { offlineStorage } from '../lib/offline-storage';
import { apiService } from '../lib/api.service';
import { waitFor } from '@testing-library/react';

// Mock apiService
jest.mock('../lib/api.service', () => ({
  apiService: {
    post: jest.fn(),
  },
}));

// Mock offlineStorage
jest.mock('../lib/offline-storage', () => ({
  offlineStorage: {
    setItem: jest.fn(),
    getItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
    keys: jest.fn(),
  },
}));

describe('synchronizeOfflineData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default to online
    Object.defineProperty(navigator, 'onLine', { writable: true, value: true });
    // Default mock for apiService.post
    (apiService.post as jest.Mock).mockResolvedValue({
      message: 'Inventory item added successfully!',
    });
  });

  it('should not synchronize if token is missing', async () => {
    await synchronizeOfflineData(null);
    expect(offlineStorage.keys).not.toHaveBeenCalled();
    expect(apiService.post).not.toHaveBeenCalled();
  });

  it('should not synchronize if offline', async () => {
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: false,
    });
    await synchronizeOfflineData('mock_token');
    expect(offlineStorage.keys).not.toHaveBeenCalled();
    expect(apiService.post).not.toHaveBeenCalled();
  });

  it('should synchronize pending inventory items when online', async () => {
    (offlineStorage.keys as jest.Mock).mockResolvedValueOnce([
      'pending-inventory-item-1',
      'pending-inventory-item-2',
    ]);
    (offlineStorage.getItem as jest.Mock)
      .mockResolvedValueOnce({
        product_id: 1,
        expiry_date: '2026-12-31',
        location_id: 1,
      })
      .mockResolvedValueOnce({
        product_id: 2,
        expiry_date: '2026-11-30',
        location_id: 2,
      });

    await synchronizeOfflineData('mock_token');

    expect(offlineStorage.keys).toHaveBeenCalledTimes(1);
    expect(offlineStorage.getItem).toHaveBeenCalledTimes(2);

    await waitFor(() => {
      expect(apiService.post).toHaveBeenCalledTimes(2);
    });

    expect(apiService.post).toHaveBeenCalledWith(
      '/inventory-items',
      {
        product_id: 1,
        expiry_date: '2026-12-31',
        location_id: 1,
      },
      'mock_token',
    );
    expect(apiService.post).toHaveBeenCalledWith(
      '/inventory-items',
      {
        product_id: 2,
        expiry_date: '2026-11-30',
        location_id: 2,
      },
      'mock_token',
    );
    expect(offlineStorage.removeItem).toHaveBeenCalledTimes(2);
    expect(offlineStorage.removeItem).toHaveBeenCalledWith('pending-inventory-item-1');
    expect(offlineStorage.removeItem).toHaveBeenCalledWith('pending-inventory-item-2');
  });

  it('should handle failed synchronization gracefully', async () => {
    (offlineStorage.keys as jest.Mock).mockResolvedValueOnce(['pending-inventory-item-1']);
    (offlineStorage.getItem as jest.Mock).mockResolvedValueOnce({
      product_id: 1,
      expiry_date: '2026-12-31',
      location_id: 1,
    });
    (apiService.post as jest.Mock).mockRejectedValueOnce(new Error('Failed to add item'));

    await synchronizeOfflineData('mock_token');

    await waitFor(() => {
      expect(apiService.post).toHaveBeenCalledTimes(1);
    });

    expect(offlineStorage.keys).toHaveBeenCalledTimes(1);
    expect(offlineStorage.getItem).toHaveBeenCalledTimes(1);
    expect(offlineStorage.removeItem).not.toHaveBeenCalled(); // Should not remove on failure
  });

  it('should do nothing if no pending items', async () => {
    (offlineStorage.keys as jest.Mock).mockResolvedValueOnce([]);

    await synchronizeOfflineData('mock_token');

    expect(offlineStorage.keys).toHaveBeenCalledTimes(1);
    expect(offlineStorage.getItem).not.toHaveBeenCalled();
    expect(apiService.post).not.toHaveBeenCalled();
    expect(offlineStorage.removeItem).not.toHaveBeenCalled();
  });
});
