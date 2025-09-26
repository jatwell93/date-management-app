import localforage from "localforage";

// Configure localforage
localforage.config({
  driver: localforage.INDEXEDDB, // Force IndexedDB; fallback to WebSQL or localStorage
  name: "retailInventoryApp",
  version: 1.0,
  storeName: "keyvaluepairs", // Should be alphanumeric, not contain '_'
  description: "Offline storage for retail inventory application",
});

export const offlineStorage = {
  setItem: async <T>(key: string, value: T): Promise<T> => {
    return localforage.setItem(key, value);
  },
  getItem: async <T>(key: string): Promise<T | null> => {
    return localforage.getItem(key);
  },
  removeItem: async (key: string): Promise<void> => {
    return localforage.removeItem(key);
  },
  clear: async (): Promise<void> => {
    return localforage.clear();
  },
  keys: async (): Promise<string[]> => {
    return localforage.keys();
  },
};
