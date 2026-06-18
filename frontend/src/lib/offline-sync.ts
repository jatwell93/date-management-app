// offline-sync.ts - Handles offline data synchronization for the PWA
import * as Sentry from '@sentry/react';
import { v4 as uuidv4 } from 'uuid';
import { STORAGE_KEYS } from '../config/handheld';
import { buildApiUrl } from './api.service';

// Define types for offline operations
type OfflineOperation = {
  id: string;
  action: 'create' | 'update' | 'delete';
  entityType: 'product' | 'inventory-item' | 'store-area' | 'user';
  data: Record<string, unknown>;
  timestamp: number;
};

type AuthTokenProvider = () => string | null | undefined | Promise<string | null | undefined>;

// Define sync strategy types
export type SyncStrategy = 'real-time' | 'batch' | 'manual';

// Queue to store offline operations
const OFFLINE_QUEUE_KEY = 'offline-queue';
const SYNC_STRATEGY_KEY = STORAGE_KEYS.SYNC_STRATEGY; // ✓ Unified key from config

const logSyncEvent = (
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  extra?: Record<string, unknown>,
) => {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  if (level === 'warning' || level === 'error') {
    Sentry.captureMessage(message, {
      level,
      tags: { feature: 'offline-sync' },
      extra,
    });
  } else {
    Sentry.addBreadcrumb({
      category: 'offline-sync',
      message,
      level: 'info',
      data: extra,
    });
  }
};

class OfflineSyncService {
  private isOnline = navigator.onLine;
  private syncInterval: NodeJS.Timeout | null = null;
  private syncInProgress = false;
  private currentStrategy: SyncStrategy;
  private authTokenProvider: AuthTokenProvider = () => null;

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

  setAuthTokenProvider(provider: AuthTokenProvider) {
    this.authTokenProvider = provider;
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
    logSyncEvent('Device is now online, starting sync...');
    this.isOnline = true;

    // Only sync automatically if not in manual mode
    if (this.currentStrategy !== 'manual') {
      this.performSync();
    }
  }

  // Handle going offline
  private handleOffline() {
    logSyncEvent('Device is now offline');
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
    data: Record<string, unknown>,
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

      logSyncEvent('Operation queued', 'info', { action, entityType, operationId: operation.id });

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
    if (!queueStr) return [];
    try {
      return JSON.parse(queueStr);
    } catch {
      return [];
    }
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

  private async processQueueOperations(
    queue: OfflineOperation[],
  ): Promise<{ allSuccessful: boolean; successfulCount: number }> {
    let allSuccessful = true;
    let successfulCount = 0;

    for (const operation of queue) {
      try {
        await this.syncOperation(operation);
        this.removeOperation(operation.id);
        successfulCount++;
        logSyncEvent('Successfully synced operation', 'info', {
          operationId: operation.id,
        });
      } catch (error) {
        if (error instanceof Error) {
          Sentry.captureException(error, {
            tags: { feature: 'offline-sync' },
            extra: { operationId: operation.id },
          });
        } else {
          logSyncEvent('Failed to sync operation', 'error', {
            operationId: operation.id,
          });
        }
        allSuccessful = false;
        break;
      }
    }

    return { allSuccessful, successfulCount };
  }

  private async waitBeforeRetry(delay: number): Promise<number> {
    logSyncEvent('Waiting before retry', 'info', { delayMs: delay });
    await this.delay(delay);
    return delay * 2;
  }

  private handleUnexpectedSyncError(error: unknown) {
    if (error instanceof Error) {
      Sentry.captureException(error, {
        tags: { feature: 'offline-sync' },
      });
      return;
    }

    logSyncEvent('Error during sync', 'error');
  }

  // Perform synchronization with exponential backoff retry logic
  async performSyncWithRetry() {
    if (this.syncInProgress) {
      logSyncEvent('Sync already in progress, skipping...');
      return;
    }

    this.syncInProgress = true;
    logSyncEvent('Starting synchronization with retry logic...');

    let retryCount = 0;
    const maxRetries = 3;
    let delay = 5000; // Initial delay of 5 seconds

    while (retryCount < maxRetries) {
      try {
        const queue = this.getOfflineQueue();
        if (queue.length === 0) {
          logSyncEvent('No operations to sync');
          break;
        }
        logSyncEvent('Found operations to sync', 'info', { count: queue.length });

        const { allSuccessful, successfulCount } = await this.processQueueOperations(queue);

        if (allSuccessful) {
          logSyncEvent('All operations synced successfully');
          break;
        }

        if (successfulCount > 0) {
          logSyncEvent('Some operations synced, not retrying failed ones');
          break;
        }

        logSyncEvent('Sync failed, retrying', 'warning', {
          attempt: retryCount + 1,
          maxRetries,
        });
        retryCount++;

        if (retryCount < maxRetries) {
          delay = await this.waitBeforeRetry(delay);
        }
      } catch (error) {
        this.handleUnexpectedSyncError(error);
        retryCount++;

        if (retryCount < maxRetries) {
          delay = await this.waitBeforeRetry(delay);
        }
      } finally {
        if (retryCount >= maxRetries) {
          logSyncEvent(
            'Max retries reached, keeping items in queue for next sync cycle',
            'warning',
          );
        }
      }
    }

    this.syncInProgress = false;
    logSyncEvent('Synchronization completed');
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
        endpoint = buildApiUrl('/products');
        break;
      case 'inventory-item':
        endpoint = buildApiUrl('/inventory-items');
        break;
      case 'store-area':
        endpoint = buildApiUrl('/store-areas');
        break;
      case 'user':
        endpoint = buildApiUrl('/users');
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
          headers: await this.getHeaders(),
          body: JSON.stringify(data),
        });
        break;
      case 'update':
        response = await fetch(`${endpoint}/${data.id}`, {
          method: 'PUT',
          headers: await this.getHeaders(),
          body: JSON.stringify(data),
        });
        break;
      case 'delete':
        response = await fetch(`${endpoint}/${data.id}`, {
          method: 'DELETE',
          headers: await this.getHeaders(),
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
    logSyncEvent('Synced operation', 'info', { action, entityType, result });
  }

  // Get properly typed headers for fetch requests
  private async getHeaders(): Promise<{ 'Content-Type': string; Authorization?: string }> {
    const token = await this.authTokenProvider();
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
