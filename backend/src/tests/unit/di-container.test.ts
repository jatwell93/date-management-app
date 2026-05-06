import 'reflect-metadata';

function loadCompositionRoot() {
  jest.resetModules();

  const mockPrisma = {
    product: {},
    inventoryItem: {},
    subscriptionTier: {},
  };
  const mockGetDefaultDatabaseClient = jest.fn(() => mockPrisma);
  const mockGetStripeClient = jest.fn();

  jest.doMock('../../database/database-factory', () => ({
    getDefaultDatabaseClient: () => mockGetDefaultDatabaseClient(),
  }));
  jest.doMock('../../utils/stripe', () => ({
    getStripeClient: (...args: unknown[]) => mockGetStripeClient(...args),
  }));

  return {
    mockPrisma,
    mockGetDefaultDatabaseClient,
    mockGetStripeClient,
    ...(require('@prisma/client') as typeof import('@prisma/client')),
    ...(require('../../di/container') as typeof import('../../di/container')),
    ...(require('../../repositories/analytics.repository') as typeof import('../../repositories/analytics.repository')),
    ...(require('../../repositories/inventory.repository') as typeof import('../../repositories/inventory.repository')),
    ...(require('../../repositories/job-lock.repository') as typeof import('../../repositories/job-lock.repository')),
    ...(require('../../repositories/organization.repository') as typeof import('../../repositories/organization.repository')),
    ...(require('../../repositories/org-audit.repository') as typeof import('../../repositories/org-audit.repository')),
    ...(require('../../repositories/product.repository') as typeof import('../../repositories/product.repository')),
    ...(require('../../repositories/storage-quota.repository') as typeof import('../../repositories/storage-quota.repository')),
    ...(require('../../repositories/store-area.repository') as typeof import('../../repositories/store-area.repository')),
    ...(require('../../repositories/subscription.repository') as typeof import('../../repositories/subscription.repository')),
    ...(require('../../repositories/upload.repository') as typeof import('../../repositories/upload.repository')),
    ...(require('../../repositories/user.repository') as typeof import('../../repositories/user.repository')),
    ...(require('../../services/inventory.service') as typeof import('../../services/inventory.service')),
    ...(require('../../services/product.service') as typeof import('../../services/product.service')),
    ...(require('../../services/subscription.service') as typeof import('../../services/subscription.service')),
  };
}

describe('DI composition root', () => {
  afterEach(() => {
    jest.dontMock('../../database/database-factory');
    jest.dontMock('../../utils/stripe');
  });

  it('registers the shared Prisma client and migrated repositories', () => {
    const modules = loadCompositionRoot();
    const container = modules.getDiContainer();

    expect(container.resolve(modules.PrismaClient)).toBe(modules.mockPrisma);
    expect(container.resolve(modules.ProductRepository)).toBeInstanceOf(modules.ProductRepository);
    expect(container.resolve(modules.InventoryRepository)).toBeInstanceOf(
      modules.InventoryRepository,
    );
    expect(container.resolve(modules.SubscriptionRepository)).toBeInstanceOf(
      modules.SubscriptionRepository,
    );
    expect(container.resolve(modules.AnalyticsRepository)).toBeInstanceOf(
      modules.AnalyticsRepository,
    );
    expect(container.resolve(modules.StoreAreaRepository)).toBeInstanceOf(
      modules.StoreAreaRepository,
    );
    expect(container.resolve(modules.OrganizationRepository)).toBeInstanceOf(
      modules.OrganizationRepository,
    );
    expect(container.resolve(modules.UserRepository)).toBeInstanceOf(modules.UserRepository);
    expect(container.resolve(modules.OrgAuditRepository)).toBeInstanceOf(
      modules.OrgAuditRepository,
    );
    expect(container.resolve(modules.UploadRepository)).toBeInstanceOf(modules.UploadRepository);
    expect(container.resolve(modules.StorageQuotaRepository)).toBeInstanceOf(
      modules.StorageQuotaRepository,
    );
    expect(container.resolve(modules.JobLockRepository)).toBeInstanceOf(modules.JobLockRepository);
  });

  it('resolves migrated service factories from registered repositories', () => {
    const modules = loadCompositionRoot();
    const container = modules.getDiContainer();

    const productServiceFactory =
      container.resolve<(organizationId: string) => unknown>('ProductServiceFactory');
    const inventoryServiceFactory =
      container.resolve<(organizationId: string) => unknown>('InventoryServiceFactory');

    expect(productServiceFactory('org-1')).toBeInstanceOf(modules.ProductService);
    expect(inventoryServiceFactory('org-1')).toBeInstanceOf(modules.InventoryService);
    expect(container.resolve(modules.SubscriptionService)).toBeInstanceOf(
      modules.SubscriptionService,
    );
  });

  it('registers Stripe as a lazy client factory', () => {
    const modules = loadCompositionRoot();
    const container = modules.getDiContainer();

    const stripeClientFactory = container.resolve<() => unknown>('StripeClientFactory');
    stripeClientFactory();

    expect(modules.mockGetStripeClient).toHaveBeenCalledTimes(1);
  });
});
