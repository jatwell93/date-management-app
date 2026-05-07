import 'reflect-metadata';
import { container, DependencyContainer } from 'tsyringe';
import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { ProductService } from '../services/product.service';
import { InventoryService } from '../services/inventory.service';
import { SubscriptionService } from '../services/subscription.service';
import { StoreAreaService } from '../services/store-area.service';
import { StorageQuotaService } from '../services/storage-quota.service';
import { getStripeClient } from '../utils/stripe';
import { ProductRepository } from '../repositories/product.repository';
import { InventoryRepository } from '../repositories/inventory.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { AnalyticsRepository } from '../repositories/analytics.repository';
import { StoreAreaRepository } from '../repositories/store-area.repository';
import { OrganizationRepository } from '../repositories/organization.repository';
import { UserRepository } from '../repositories/user.repository';
import { OrgAuditRepository } from '../repositories/org-audit.repository';
import { UploadRepository } from '../repositories/upload.repository';
import { StorageQuotaRepository } from '../repositories/storage-quota.repository';
import { JobLockRepository } from '../repositories/job-lock.repository';

let initialized = false;

/**
 * Get or initialize the DI container state
 */
export function getDiContainer(): DependencyContainer {
  if (!initialized) {
    initializeDiContainer();
  }
  return container;
}

/**
 * Initialize the DI container
 */
export function initializeDiContainer(): void {
  if (initialized) return;

  // Register PrismaClient as a singleton
  container.registerInstance(PrismaClient, getDefaultDatabaseClient());

  // Register Repositories
  container.registerSingleton(ProductRepository);
  container.registerSingleton(InventoryRepository);
  container.registerSingleton(SubscriptionRepository);
  container.registerSingleton(AnalyticsRepository);
  container.registerSingleton(StoreAreaRepository);
  container.registerSingleton(OrganizationRepository);
  container.registerSingleton(UserRepository);
  container.registerSingleton(OrgAuditRepository);
  container.registerSingleton(UploadRepository);
  container.registerSingleton(StorageQuotaRepository);
  container.registerSingleton(JobLockRepository);

  container.register(SubscriptionService, {
    useFactory: (dependencyContainer) =>
      new SubscriptionService(dependencyContainer.resolve(PrismaClient)),
  });
  container.register('StripeClientFactory', {
    useValue: getStripeClient,
  });

  // Register ProductService factory
  container.register('ProductServiceFactory', {
    useValue: (orgId: string) => {
      const prisma = container.resolve(PrismaClient);
      const productRepo = container.resolve(ProductRepository);
      const subscriptionRepo = container.resolve(SubscriptionRepository);
      return new ProductService(prisma, orgId, productRepo, subscriptionRepo);
    },
  });

  // Register InventoryService factory
  container.register('InventoryServiceFactory', {
    useValue: (orgId: string) => {
      const prisma = container.resolve(PrismaClient);
      const inventoryRepo = container.resolve(InventoryRepository);
      const productRepo = container.resolve(ProductRepository);
      return new InventoryService(orgId, prisma, inventoryRepo, productRepo);
    },
  });

  container.register('StoreAreaServiceFactory', {
    useValue: (orgId?: string) => new StoreAreaService(orgId),
  });

  container.register('StorageQuotaServiceFactory', {
    useValue: (organizationId?: string) => new StorageQuotaService(organizationId),
  });

  initialized = true;
}

/**
 * Reset the DI container state
 * Useful for tests that need clean instances
 */
export function resetDiContainer(): void {
  container.reset();
  initialized = false;
}
