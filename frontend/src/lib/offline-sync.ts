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

// Queue to store offline operations
const OFFLINE_QUEUE_KEY = 'offline-queue';
const PENDING_OPERATIONS_KEY = 'pending-operations';

class OfflineSyncService {
  private isOnline = navigator.onLine;
  private syncInterval: NodeJS.Timeout | null = null;
  private syncInProgress = false;

  constructor() {
    // Initialize online/offline status
    this.isOnline = navigator.onLine;
    
    // Set up event listeners for online/offline status
    window.addEventListener('online', this.handleOnline.bind(this));
    window.addEventListener('offline', this.handleOffline.bind(this));
    
    // Initialize periodic sync
    this.scheduleSync();
  }

  // Handle going online
  private handleOnline() {
    console.log('Device is now online, starting sync...');
    this.isOnline = true;
    this.performSync();
  }

  // Handle going offline
  private handleOffline() {
    console.log('Device is now offline');
    this.isOnline = false;
  }

  // Schedule periodic sync
  private scheduleSync() {
    // Try to sync every 30 seconds when online
    this.syncInterval = setInterval(() => {
      if (this.isOnline && !this.syncInProgress) {
        this.performSync();
      }
    }, 30000);
  }

  // Add an operation to the offline queue
  addOperation(
    action: 'create' | 'update' | 'delete', 
    entityType: 'product' | 'inventory-item' | 'store-area' | 'user', 
    data: any
  ): Promise<void> {
    return new Promise((resolve) => {
      const operation: OfflineOperation = {
        id: uuidv4(),
        action,
        entityType,
        data,
        timestamp: Date.now()
      };

      // Get current offline queue
      const queue: OfflineOperation[] = this.getOfflineQueue();
      
      // Add new operation to queue
      queue.push(operation);
      
      // Save updated queue to localStorage
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
      
      console.log(`Operation queued: ${action} ${entityType}`, operation);
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
    return queue.filter(op => op.entityType === entityType);
  }

  // Remove an operation from the queue
  private removeOperation(id: string) {
    const queue = this.getOfflineQueue();
    const updatedQueue = queue.filter(op => op.id !== id);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(updatedQueue));
  }

  // Perform synchronization
  async performSync() {
    if (this.syncInProgress) {
      console.log('Sync already in progress, skipping...');
      return;
    }

    this.syncInProgress = true;
    console.log('Starting synchronization...');
    
    try {
      // Get operations from the queue
      const queue = this.getOfflineQueue();
      if (queue.length === 0) {
        console.log('No operations to sync');
        return;
      }

      console.log(`Found ${queue.length} operations to sync`);

      // Process each operation in sequence
      for (const operation of queue) {
        try {
          // Attempt to sync the operation with the backend
          await this.syncOperation(operation);
          
          // If successful, remove from queue
          this.removeOperation(operation.id);
          console.log(`Successfully synced operation: ${operation.id}`);
        } catch (error) {
          console.error(`Failed to sync operation ${operation.id}:`, error);
          // Keep the operation in the queue for retry
          break; // Stop processing further operations if one fails
        }
      }
    } catch (error) {
      console.error('Error during sync:', error);
    } finally {
      this.syncInProgress = false;
      console.log('Synchronization completed');
    }
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
          body: JSON.stringify(data)
        });
        break;
      case 'update':
        response = await fetch(`${endpoint}/${data.id}`, {
          method: 'PUT',
          headers: this.getHeaders(),
          body: JSON.stringify(data)
        });
        break;
      case 'delete':
        response = await fetch(`${endpoint}/${data.id}`, {
          method: 'DELETE',
          headers: this.getHeaders()
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
        'Authorization': `Bearer ${token}`
      };
    }
    return {};
  }

  // Get properly typed headers for fetch requests
  private getHeaders(): { 'Content-Type': string; 'Authorization'?: string } {
    const token = localStorage.getItem('token');
    const headers: { 'Content-Type': string; 'Authorization'?: string } = {
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