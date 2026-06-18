import { offlineStorage } from './offline-storage';
import { apiService } from './api.service';
import { ClerkTokenGetter, resolveApiToken } from './auth-token';

const PENDING_INVENTORY_ITEMS_PREFIX = 'pending-inventory-item-';

// ✓ Get count of pending inventory items (fixes 17.3)
export async function getPendingInventoryItemCount(): Promise<number> {
  const keys = await offlineStorage.keys();
  return keys.filter((key) => key.startsWith(PENDING_INVENTORY_ITEMS_PREFIX)).length;
}

type OfflineSyncTokenSource = string | null | ClerkTokenGetter;

async function resolveOfflineSyncToken(
  tokenSource: OfflineSyncTokenSource,
): Promise<string | undefined> {
  if (typeof tokenSource === 'function') {
    return resolveApiToken({
      fallbackToken: null,
      getToken: tokenSource,
      actionTag: 'offline-sync',
    });
  }

  return tokenSource || undefined;
}

export async function synchronizeOfflineData(token: OfflineSyncTokenSource) {
  if (!token) {
    // console.warn("Synchronization skipped: No authentication token available.");
    return;
  }

  if (!navigator.onLine) {
    // console.log("Synchronization skipped: Application is offline.");
    return;
  }

  // console.log("Attempting to synchronize offline data...");
  const keys = await offlineStorage.keys();
  const pendingInventoryItemKeys = keys.filter((key) =>
    key.startsWith(PENDING_INVENTORY_ITEMS_PREFIX),
  );

  if (pendingInventoryItemKeys.length === 0) {
    // console.log("No pending offline inventory items to synchronize.");
    return;
  }

  for (const key of pendingInventoryItemKeys) {
    const item = await offlineStorage.getItem(key);
    if (item) {
      try {
        const authToken = await resolveOfflineSyncToken(token);
        if (!authToken) {
          return;
        }
        // console.log(`Synchronizing item: ${key}`, item);
        await apiService.post('/inventory-items', item, authToken);

        // console.log(`Successfully synchronized item: ${key}`);
        await offlineStorage.removeItem(key);
      } catch (err: unknown) {
        if (err instanceof Error) {
          // eslint-disable-next-line no-console
          console.error(`Error synchronizing item ${key}:`, err);
          // Could add user notification here if needed
        } else {
          // eslint-disable-next-line no-console
          console.error(`An unknown error occurred while synchronizing item ${key}`, err);
        }
        // Keep item in offline storage for retry later
      }
    }
  }
  // console.log("Offline data synchronization attempt finished.");
}
