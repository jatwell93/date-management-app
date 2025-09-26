import { offlineStorage } from "./offline-storage";

const PENDING_INVENTORY_ITEMS_PREFIX = "pending-inventory-item-";

export async function synchronizeOfflineData(token: string | null) {
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
        // console.log(`Synchronizing item: ${key}`, item);
        const response = await fetch("http://localhost:3001/inventory-items", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(item),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.message || "Failed to synchronize inventory item",
          );
        }

        // console.log(`Successfully synchronized item: ${key}`);
        await offlineStorage.removeItem(key);
      } catch (_err: unknown) {
        // if (_err instanceof Error) {
        //   console.error(`Error synchronizing item ${key}:`, _err.message);
        // } else {
        //   console.error(
        //     `An unknown error occurred while synchronizing item ${key}`,
        //   );
        // }
        // Keep item in offline storage for retry later
      }
    }
  }
  // console.log("Offline data synchronization attempt finished.");
}
