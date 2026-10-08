import { useState, useEffect, useCallback } from 'react';
import { getPendingInventoryItemCount } from '../lib/sync-manager';

export function useSyncStatus(isLoggedIn: boolean): {
  isOnline: boolean;
  pendingQueueCount: number;
  refreshPendingQueueCount: () => Promise<void>;
} {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);

  const refreshPendingQueueCount = useCallback(async () => {
    try {
      setPendingQueueCount(await getPendingInventoryItemCount());
    } catch (_error) {
      setPendingQueueCount(0);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: kicks off initial queue-count fetch, then polls on an interval
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
