/**
 * Service Factory Functions
 *
 * Provides factory methods for instantiating application services.
 * Used by routes and middleware to create service instances.
 *
 * Future: Will be replaced with full DI framework integration.
 */

import { WebhookController } from '../controllers/webhook.controller';
import { ProductController } from '../controllers/product.controller';
import { SubscriptionController } from '../controllers/subscription.controller';
import { InventoryController } from '../controllers/inventory.controller';
import { StoreAreaController } from '../controllers/store-area.controller';
import { StorageQuotaController } from '../controllers/storage-quota.controller';
import { getDiContainer } from './container';

/**
 * Factory function to create WebhookController instance
 * Dependencies are resolved from the DI container
 */
export function createWebhookController(): WebhookController {
  return getDiContainer().resolve(WebhookController);
}

/**
 * Factory function to create ProductController instance
 */
export function createProductController(): ProductController {
  return getDiContainer().resolve(ProductController);
}

/**
 * Factory function to create SubscriptionController instance
 */
export function createSubscriptionController(): SubscriptionController {
  return getDiContainer().resolve(SubscriptionController);
}

/**
 * Factory function to create InventoryController instance
 */
export function createInventoryController(): InventoryController {
  return getDiContainer().resolve(InventoryController);
}

export function createStoreAreaController(): StoreAreaController {
  return getDiContainer().resolve(StoreAreaController);
}

export function createStorageQuotaController(): StorageQuotaController {
  return getDiContainer().resolve(StorageQuotaController);
}

/**
 * Register all application services
 * Currently a no-op; called during app startup for future compatibility
 */
export function registerApplicationServices(): void {
  // No-op for now; will be expanded when full DI framework is integrated
}
