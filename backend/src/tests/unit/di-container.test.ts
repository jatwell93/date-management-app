import 'reflect-metadata';

async function loadCompositionRoot() {
  vi.resetModules();

  const mockPrisma = {
    product: {},
    inventoryItem: {},
    subscriptionTier: {},
  };
  const mockGetDefaultDatabaseClient = vi.fn(() => mockPrisma);
  const mockGetStripeClient = vi.fn();

  vi.doMock('../../database/database-factory', () => ({
    getDefaultDatabaseClient: () => mockGetDefaultDatabaseClient(),
  }));
  vi.doMock('../../utils/stripe', () => ({
    getStripeClient: (...args: unknown[]) => mockGetStripeClient(...args),
  }));

  return {
    mockPrisma,
    mockGetDefaultDatabaseClient,
    mockGetStripeClient,
    ...((await import('@prisma/client')) as typeof import('@prisma/client')),
    ...((await import('../../di/container')) as typeof import('../../di/container')),
    ...((await import('../../repositories/analytics.repository')) as typeof import('../../repositories/analytics.repository')),
    ...((await import('../../repositories/inventory.repository')) as typeof import('../../repositories/inventory.repository')),
    ...((await import('../../repositories/job-lock.repository')) as typeof import('../../repositories/job-lock.repository')),
    ...((await import('../../repositories/organization.repository')) as typeof import('../../repositories/organization.repository')),
    ...((await import('../../repositories/org-audit.repository')) as typeof import('../../repositories/org-audit.repository')),
    ...((await import('../../repositories/product.repository')) as typeof import('../../repositories/product.repository')),
    ...((await import('../../repositories/storage-quota.repository')) as typeof import('../../repositories/storage-quota.repository')),
    ...((await import('../../repositories/store-area.repository')) as typeof import('../../repositories/store-area.repository')),
    ...((await import('../../repositories/subscription.repository')) as typeof import('../../repositories/subscription.repository')),
    ...((await import('../../repositories/upload.repository')) as typeof import('../../repositories/upload.repository')),
    ...((await import('../../repositories/user.repository')) as typeof import('../../repositories/user.repository')),
    ...((await import('../../services/inventory.service')) as typeof import('../../services/inventory.service')),
    ...((await import('../../services/product.service')) as typeof import('../../services/product.service')),
    ...((await import('../../services/subscription.service')) as typeof import('../../services/subscription.service')),
  };
}

describe('DI composition root', () => {
  afterEach(() => {
    vi.doUnmock('../../database/database-factory');
    vi.doUnmock('../../utils/stripe');
  });

  it('registers the shared Prisma client and migrated repositories', async () => {
    const modules = await loadCompositionRoot();
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

  it('resolves migrated service factories from registered repositories', async () => {
    const modules = await loadCompositionRoot();
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

  it('registers Stripe as a lazy client factory', async () => {
    const modules = await loadCompositionRoot();
    const container = modules.getDiContainer();

    const stripeClientFactory = container.resolve<() => unknown>('StripeClientFactory');
    stripeClientFactory();

    expect(modules.mockGetStripeClient).toHaveBeenCalledTimes(1);
  });
});
