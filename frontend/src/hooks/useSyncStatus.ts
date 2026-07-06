import { useState, useEffect, useCallback } from 'react';
import { getPendingInventoryItemCount } from '../lib/sync-manager';
import { offlineSyncService } from '../lib/offline-sync';

export function useSyncStatus(isLoggedIn: boolean): {
  isOnline: boolean;
  pendingQueueCount: number;
  refreshPendingQueueCount: () => Promise<void>;
} {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);

  const refreshPendingQueueCount = useCallback(async () => {
    try {
      const pendingInventoryCount = await getPendingInventoryItemCount();
      const operationQueueCount = offlineSyncService.getPendingOperationCount();
      setPendingQueueCount(pendingInventoryCount + operationQueueCount);
    } catch (_error) {
      setPendingQueueCount(offlineSyncService.getPendingOperationCount());
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    void refreshPendingQueueCount();
    const intervalId = window.setInterval(() => {
      void refreshPendingQueueCount();
    }, 2000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [isLoggedIn, refreshPendingQueueCount]);

  return { isOnline, pendingQueueCount, refreshPendingQueueCount };
}
