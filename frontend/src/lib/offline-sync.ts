// offline-sync.ts - Handles offline data synchronization for the PWA
import { v4 as uuidv4 } from 'uuid';

// Define types for offline operations
type OfflineOperation = {
  id: string;
  action: 'create' | 'update' | 'delete';
  entityType: 'product' | 'inventory-item' | 'store-area' | 'user';
  data: any;
  timestamp: number;
};

// Define sync strategy types
export type SyncStrategy = 'real-time' | 'batch' | 'manual';

// Queue to store offline operations
const OFFLINE_QUEUE_KEY = 'offline-queue';
const SYNC_STRATEGY_KEY = 'sync-strategy';

class OfflineSyncService {
  private isOnline = navigator.onLine;
  private syncInterval: NodeJS.Timeout | null = null;
  private syncInProgress = false;
  private currentStrategy: SyncStrategy;

  constructor() {
    // Initialize online/offline status
    this.isOnline = navigator.onLine;

    // Load sync strategy from localStorage or default to 'real-time'
    this.currentStrategy = this.loadSyncStrategy();

    // Set up event listeners for online/offline status
    window.addEventListener('online', this.handleOnline.bind(this));
    window.addEventListener('offline', this.handleOffline.bind(this));

    // Initialize periodic sync
    this.scheduleSync();
  }

  // Load sync strategy from localStorage
  private loadSyncStrategy(): SyncStrategy {
    const storedStrategy = localStorage.getItem(SYNC_STRATEGY_KEY);
    if (storedStrategy && ['real-time', 'batch', 'manual'].includes(storedStrategy)) {
      return storedStrategy as SyncStrategy;
    }
    return 'real-time'; // default strategy
  }

  // Set sync strategy and persist to localStorage
  setSyncStrategy(strategy: SyncStrategy) {
    this.currentStrategy = strategy;
    localStorage.setItem(SYNC_STRATEGY_KEY, strategy);

    // Reschedule sync with new strategy
    this.rescheduleSync();
  }

  // Get current sync strategy
  getSyncStrategy(): SyncStrategy {
    return this.currentStrategy;
  }

  // Reschedule sync based on current strategy
  private rescheduleSync() {
    // Clear existing interval
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    // Schedule new interval based on strategy
    if (this.currentStrategy === 'manual') {
      // For manual strategy, don't schedule automatic syncs
      return;
    }

    // Determine interval based on strategy
    const intervalTime = this.currentStrategy === 'batch' ? 600000 : 30000; // 10 minutes for batch, 30 seconds for real-time

    this.syncInterval = setInterval(() => {
      if (this.isOnline && !this.syncInProgress) {
        this.performSync();
      }
    }, intervalTime);
  }

  // Handle going online
  private handleOnline() {
    console.log('Device is now online, starting sync...');
    this.isOnline = true;

    // Only sync automatically if not in manual mode
    if (this.currentStrategy !== 'manual') {
      this.performSync();
    }
  }

  // Handle going offline
  private handleOffline() {
    console.log('Device is now offline');
    this.isOnline = false;
  }

  // Schedule periodic sync
  private scheduleSync() {
    this.rescheduleSync();
  }

  // Add an operation to the offline queue
  addOperation(
    action: 'create' | 'update' | 'delete',
    entityType: 'product' | 'inventory-item' | 'store-area' | 'user',
    data: any,
  ): Promise<void> {
    return new Promise((resolve) => {
      const operation: OfflineOperation = {
        id: uuidv4(),
        action,
        entityType,
        data,
        timestamp: Date.now(),
      };

      // Get current offline queue
      const queue: OfflineOperation[] = this.getOfflineQueue();

      // Add new operation to queue
      queue.push(operation);

      // Save updated queue to localStorage
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));

      console.log(`Operation queued: ${action} ${entityType}`, operation);

      // If in real-time mode, trigger sync immediately
      if (this.currentStrategy === 'real-time') {
        this.performSync();
      }

      resolve();
    });
  }

  // Get the offline queue
  private getOfflineQueue(): OfflineOperation[] {
    const queueStr = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return queueStr ? JSON.parse(queueStr) : [];
  }

  // Get pending operations for a specific entity type
  getPendingOperations(entityType: string): OfflineOperation[] {
    const queue = this.getOfflineQueue();
    return queue.filter((op) => op.entityType === entityType);
  }

  // Remove an operation from the queue
  private removeOperation(id: string) {
    const queue = this.getOfflineQueue();
    const updatedQueue = queue.filter((op) => op.id !== id);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(updatedQueue));
  }

  // Perform synchronization - main entry point that uses retry logic
  async performSync() {
    // Use the retry logic version
    await this.performSyncWithRetry();
  }

  // Perform synchronization with exponential backoff retry logic
  async performSyncWithRetry() {
    if (this.syncInProgress) {
      console.log('Sync already in progress, skipping...');
      return;
    }

    this.syncInProgress = true;
    console.log('Starting synchronization with retry logic...');

    let retryCount = 0;
    const maxRetries = 3;
    let delay = 5000; // Initial delay of 5 seconds

    while (retryCount < maxRetries) {
      try {
        // Get operations from the queue
        const queue = this.getOfflineQueue();
        if (queue.length === 0) {
          console.log('No operations to sync');
          return;
        }

        console.log(`Found ${queue.length} operations to sync`);

        // Process each operation in sequence
        let allSuccessful = true;
        let successfulCount = 0;
        for (const operation of queue) {
          try {
            // Attempt to sync the operation with the backend
            await this.syncOperation(operation);

            // If successful, remove from queue
            this.removeOperation(operation.id);
            successfulCount++;
            console.log(`Successfully synced operation: ${operation.id}`);
          } catch (error) {
            console.error(`Failed to sync operation ${operation.id}:`, error);
            // Keep the operation in the queue for retry
            allSuccessful = false;
            break; // Stop processing further operations if one fails
          }
        }

        if (allSuccessful) {
          console.log('All operations synced successfully');
          break; // Exit retry loop if all operations were successful
        } else if (successfulCount > 0) {
          console.log('Some operations synced, not retrying failed ones');
          break;
        } else {
          console.log(`Sync failed, attempt ${retryCount + 1}/${maxRetries}`);
          retryCount++;

          if (retryCount < maxRetries) {
            console.log(`Waiting ${delay / 1000}s before retry...`);
            await this.delay(delay);

            // Double the delay for next retry (exponential backoff)
            delay *= 2;
          }
        }
      } catch (error) {
        console.error('Error during sync:', error);
        retryCount++;

        if (retryCount < maxRetries) {
          console.log(`Waiting ${delay / 1000}s before retry...`);
          await this.delay(delay);

          // Double the delay for next retry (exponential backoff)
          delay *= 2;
        }
      } finally {
        if (retryCount >= maxRetries) {
          console.log('Max retries reached, keeping items in queue for next sync cycle');
        }
      }
    }

    this.syncInProgress = false;
    console.log('Synchronization completed');
  }

  // Helper function to create a delay
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Sync a single operation
  private async syncOperation(operation: OfflineOperation): Promise<void> {
    const { action, entityType, data } = operation;

    // Construct the appropriate endpoint URL based on entity type
    let endpoint = '';
    switch (entityType) {
      case 'product':
        endpoint = `${process.env.REACT_APP_API_BASE_URL}/products`;
        break;
      case 'inventory-item':
        endpoint = `${process.env.REACT_APP_API_BASE_URL}/inventory-items`;
        break;
      case 'store-area':
        endpoint = `${process.env.REACT_APP_API_BASE_URL}/store-areas`;
        break;
      case 'user':
        endpoint = `${process.env.REACT_APP_API_BASE_URL}/users`;
        break;
      default:
        throw new Error(`Unknown entity type: ${entityType}`);
    }

    // Execute the appropriate HTTP request based on action
    let response;
    switch (action) {
      case 'create':
        response = await fetch(endpoint, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(data),
        });
        break;
      case 'update':
        response = await fetch(`${endpoint}/${data.id}`, {
          method: 'PUT',
          headers: this.getHeaders(),
          body: JSON.stringify(data),
        });
        break;
      case 'delete':
        response = await fetch(`${endpoint}/${data.id}`, {
          method: 'DELETE',
          headers: this.getHeaders(),
        });
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    // Check if the request was successful
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    // Parse the response
    const result = await response.json();
    console.log(`Synced ${action} for ${entityType}:`, result);
  }

  // Get authentication headers
  private getAuthHeaders() {
    const token = localStorage.getItem('token');
    if (token) {
      return {
        Authorization: `Bearer ${token}`,
      };
    }
    return {};
  }

  // Get properly typed headers for fetch requests
  private getHeaders(): { 'Content-Type': string; Authorization?: string } {
    const token = localStorage.getItem('token');
    const headers: { 'Content-Type': string; Authorization?: string } = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  }

  // Check if we're currently offline
  isCurrentlyOffline(): boolean {
    return !this.isOnline;
  }

  // Get the number of pending operations
  getPendingOperationCount(): number {
    return this.getOfflineQueue().length;
  }

  // Clear the entire offline queue (use with caution!)
  clearQueue(): void {
    localStorage.removeItem(OFFLINE_QUEUE_KEY);
  }
}

// Create a singleton instance
export const offlineSyncService = new OfflineSyncService();

// Hook to use offline sync in components
export const useOfflineSync = () => {
  return offlineSyncService;
};
