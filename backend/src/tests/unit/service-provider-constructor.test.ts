import { ServiceProvider } from '../../services/service-provider';
import { PrismaClient } from '@prisma/client';

describe('ServiceProvider - Constructor Fix', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalTestAuthBypass = process.env.TEST_AUTH_BYPASS;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.TEST_AUTH_BYPASS = originalTestAuthBypass;
  });

  describe('Config Object Constructor', () => {
    // The org-less default comes from the test auth bypass, not from the constructor, so
    // these two set the environment rather than inheriting it. Under the production-shaped
    // Neon config (`tests/setup-neon-env.ts:4-5`) the bypass is off and this must throw.
    it('should use default values when no config provided and the bypass is enabled', () => {
      process.env.NODE_ENV = 'test';
      process.env.TEST_AUTH_BYPASS = 'true';
      const provider = new ServiceProvider();
      expect(provider).toBeDefined();
    });

    it('should refuse to default the tenant when the bypass is off', () => {
      process.env.NODE_ENV = 'production';
      process.env.TEST_AUTH_BYPASS = 'true';
      expect(() => new ServiceProvider()).toThrow(
        'Organization ID is required unless the test auth bypass is enabled',
      );
    });

    it('should accept organizationId in config', () => {
      const provider = new ServiceProvider({ organizationId: 'test-org' });
      expect(provider).toBeDefined();
    });

    it('should accept custom prisma client', () => {
      const mockPrisma = {} as PrismaClient;
      const provider = new ServiceProvider({ organizationId: 'test-org', prisma: mockPrisma });
      expect(provider).toBeDefined();
    });

    it('should accept custom storage provider', () => {
      const provider = new ServiceProvider({
        organizationId: 'test-org',
        storageProvider: {} as any,
      });
      expect(provider).toBeDefined();
    });

    it('should accept all config options', () => {
      const mockPrisma = {} as PrismaClient;
      const provider = new ServiceProvider({
        organizationId: 'test-org',
        prisma: mockPrisma,
        storageProvider: {} as any,
      });
      expect(provider).toBeDefined();
    });
  });

  describe('Factory Methods', () => {
    it('should create provider for organization', () => {
      const provider = ServiceProvider.forOrganization('org-123');
      expect(provider).toBeDefined();
    });

    it('should create provider for testing', () => {
      const provider = ServiceProvider.forTesting();
      expect(provider).toBeDefined();
    });

    it('should create provider with custom clients', () => {
      const mockPrisma = {} as PrismaClient;
      const provider = ServiceProvider.withClients(mockPrisma);
      expect(provider).toBeDefined();
    });

    it('should combine factory methods with config', () => {
      const mockPrisma = {} as PrismaClient;
      const provider = ServiceProvider.forOrganization('org-123', {
        prisma: mockPrisma,
      });
      expect(provider).toBeDefined();
    });
  });

  describe('Migrated seam caching', () => {
    it('reuses repository-backed services and repositories per provider instance', () => {
      const mockPrisma = {} as PrismaClient;
      const provider = ServiceProvider.withClients(mockPrisma, {} as any);

      expect(provider.getUploadRepository()).toBe(provider.getUploadRepository());
      expect(provider.getStorageQuotaRepository()).toBe(provider.getStorageQuotaRepository());
      expect(provider.getReportRepository()).toBe(provider.getReportRepository());
      expect(provider.getDashboardService()).toBe(provider.getDashboardService());
      expect(provider.getUploadService()).toBe(provider.getUploadService());
      expect(provider.getStorageQuotaService()).toBe(provider.getStorageQuotaService());
    });
  });

  describe('Type Safety', () => {
    it('should prevent ambiguous parameter passing', () => {
      // This should be impossible with the new API:
      // new ServiceProvider(prisma, storage) // Ambiguous!
      // new ServiceProvider(orgId, prisma)   // Clear!

      const mockPrisma = {} as PrismaClient;
      const provider1 = ServiceProvider.withClients(mockPrisma);
      const provider2 = ServiceProvider.forOrganization('org-123');

      expect(provider1).toBeDefined();
      expect(provider2).toBeDefined();
    });
  });
});
