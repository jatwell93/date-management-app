import { offlineSyncService } from '../offline-sync';
import { v4 as uuidv4 } from 'uuid';

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
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Spy on navigator.onLine
const mockNavigatorOnline = jest.spyOn(navigator, 'onLine', 'get');

describe('OfflineSyncService', () => {
  const OFFLINE_QUEUE_KEY = 'offline-queue';

  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    
    // Reset fetch mock for each test
    global.fetch = jest.fn();

    offlineSyncService.clearQueue();
    // Reset online status
    mockNavigatorOnline.mockReturnValue(true);
    
    // Force reset internal state of singleton
    // @ts-ignore
    offlineSyncService.isOnline = true;
    // @ts-ignore
    offlineSyncService.syncInProgress = false;
  });

  describe('Queue Management', () => {
    it('should add operations to the queue', async () => {
      const operationData = { name: 'Test Product' };
      await offlineSyncService.addOperation('create', 'product', operationData);

      const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({
        action: 'create',
        entityType: 'product',
        data: operationData,
      });
      expect(queue[0].id).toBeDefined();
      expect(queue[0].timestamp).toBeDefined();
    });

    it('should retrieve pending operations by entity type', async () => {
      await offlineSyncService.addOperation('create', 'product', { id: 1 });
      await offlineSyncService.addOperation('update', 'user', { id: 2 });
      await offlineSyncService.addOperation('delete', 'product', { id: 3 });

      const productOps = offlineSyncService.getPendingOperations('product');
      const userOps = offlineSyncService.getPendingOperations('user');

      expect(productOps).toHaveLength(2);
      expect(userOps).toHaveLength(1);
    });

    it('should count pending operations correctly', async () => {
      expect(offlineSyncService.getPendingOperationCount()).toBe(0);
      await offlineSyncService.addOperation('create', 'product', {});
      expect(offlineSyncService.getPendingOperationCount()).toBe(1);
    });

    it('should clear the queue', async () => {
      await offlineSyncService.addOperation('create', 'product', {});
      offlineSyncService.clearQueue();
      expect(offlineSyncService.getPendingOperationCount()).toBe(0);
      expect(localStorage.getItem(OFFLINE_QUEUE_KEY)).toBeNull();
    });
  });

  describe('Synchronization Logic', () => {
    it('should sync operations when online', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      await offlineSyncService.addOperation('create', 'product', { name: 'Sync Me' });
      
      await offlineSyncService.performSync();

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(offlineSyncService.getPendingOperationCount()).toBe(0);
    });

    it('should not sync when queue is empty', async () => {
      await offlineSyncService.performSync();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should stop syncing if an operation fails', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        })
        .mockRejectedValueOnce(new Error('Network Error'));

      await offlineSyncService.addOperation('create', 'product', { id: 1 }); // Should succeed
      await offlineSyncService.addOperation('create', 'product', { id: 2 }); // Should fail
      await offlineSyncService.addOperation('create', 'product', { id: 3 }); // Should not run

      await offlineSyncService.performSync();

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(offlineSyncService.getPendingOperationCount()).toBe(2); // 2 and 3 remain
    });

    it('should retry failed operations on next sync', async () => {
      // First attempt fails
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network Error'));
      
      await offlineSyncService.addOperation('create', 'product', { id: 1 });
      await offlineSyncService.performSync();
      
      expect(offlineSyncService.getPendingOperationCount()).toBe(1);

      // Second attempt succeeds
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await offlineSyncService.performSync();
      
      expect(offlineSyncService.getPendingOperationCount()).toBe(0);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Online/Offline Handling', () => {
    it('should report correct offline status', () => {
      expect(offlineSyncService.isCurrentlyOffline()).toBe(false);
      
      // Manually trigger handleOffline to update state
      // @ts-ignore
      offlineSyncService.handleOffline();
      
      expect(offlineSyncService.isCurrentlyOffline()).toBe(true);
    });

    it('should trigger sync when coming online', () => {
      const syncSpy = jest.spyOn(offlineSyncService, 'performSync');
      
      // Go offline
      // @ts-ignore
      offlineSyncService.handleOffline();
      
      // Go online (should trigger sync)
      // @ts-ignore
      offlineSyncService.handleOnline();

      expect(syncSpy).toHaveBeenCalled();
      
      // CRITICAL: Restore the spy so subsequent tests don't fail
      syncSpy.mockRestore();
    });
  });

  describe('API Endpoint & Method Mapping', () => {
     beforeEach(() => {
         (global.fetch as jest.Mock).mockResolvedValue({
             ok: true,
             json: async () => ({ success: true }),
         });
         // Force reset internal state again just to be safe
         // @ts-ignore
         offlineSyncService.syncInProgress = false;
         // @ts-ignore
         offlineSyncService.isOnline = true;
     });

     it('should send POST request for create', async () => {
         await offlineSyncService.addOperation('create', 'product', { name: 'Test' });
         
         await offlineSyncService.performSync();
         
         expect(global.fetch).toHaveBeenCalledWith(
             expect.stringContaining('/products'),
             expect.objectContaining({ method: 'POST' })
         );
     });

     it('should send PUT request for update', async () => {
        await offlineSyncService.addOperation('update', 'inventory-item', { id: 123, status: 'sold' });
        
        await offlineSyncService.performSync();
        
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/inventory-items/123'),
            expect.objectContaining({ method: 'PUT' })
        );
    });

    it('should send DELETE request for delete', async () => {
        await offlineSyncService.addOperation('delete', 'store-area', { id: 456 });
        
        await offlineSyncService.performSync();
        
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/store-areas/456'),
            expect.objectContaining({ method: 'DELETE' })
        );
    });
  });
});
