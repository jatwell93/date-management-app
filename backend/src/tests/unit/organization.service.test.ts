import { OrganizationService } from '../../services/organization.service';
import { PrismaClient } from '@prisma/client';

const invalidateSubscriptionCacheMock = jest.fn();

jest.mock('../../middleware/auth.middleware', () => ({
  invalidateSubscriptionCache: (organizationId: string) =>
    invalidateSubscriptionCacheMock(organizationId),
}));

describe('OrganizationService', () => {
  let organizationService: OrganizationService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      organization: {
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      itemTransaction: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      expiredItemTransaction: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      upload: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      organizationInvite: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      inventoryItem: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      storeArea: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      product: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      subscriptionTier: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      trialEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      organizationUsage: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    mockPrisma.$transaction = jest.fn(async (operation: (tx: typeof mockPrisma) => Promise<void>) =>
      operation(mockPrisma),
    );
    organizationService = new OrganizationService(mockPrisma as unknown as PrismaClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getOrganization', () => {
    it('should return organization if found', async () => {
      const mockOrg = {
        id: 'org-123',
        name: 'Test Organization',
        slug: 'test-org',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.organization.findUnique.mockResolvedValue(mockOrg);

      const org = await organizationService.getOrganization('org-123');

      expect(org).not.toBeNull();
      expect(org?.id).toBe('org-123');
      expect(org?.name).toBe('Test Organization');
      expect(org?.slug).toBe('test-org');
      expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith({
        where: { id: 'org-123' },
      });
    });

    it('should return null if organization not found', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      const org = await organizationService.getOrganization('non-existent');

      expect(org).toBeNull();
    });
  });

  describe('updateOrganization', () => {
    it('should update organization name successfully', async () => {
      const mockUpdatedOrg = {
        id: 'org-123',
        name: 'Updated Organization',
        slug: 'test-org',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.organization.update.mockResolvedValue(mockUpdatedOrg);

      const org = await organizationService.updateOrganization('org-123', {
        name: 'Updated Organization',
      });

      expect(org).not.toBeNull();
      expect(org?.name).toBe('Updated Organization');
      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-123' },
        data: { name: 'Updated Organization' },
      });
    });

    it('should update organization slug successfully', async () => {
      const mockUpdatedOrg = {
        id: 'org-123',
        name: 'Test Organization',
        slug: 'updated-slug',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.organization.update.mockResolvedValue(mockUpdatedOrg);

      const org = await organizationService.updateOrganization('org-123', {
        slug: 'updated-slug',
      });

      expect(org).not.toBeNull();
      expect(org?.slug).toBe('updated-slug');
      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-123' },
        data: { slug: 'updated-slug' },
      });
    });

    it('should update both name and slug successfully', async () => {
      const mockUpdatedOrg = {
        id: 'org-123',
        name: 'New Name',
        slug: 'new-slug',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.organization.update.mockResolvedValue(mockUpdatedOrg);

      const org = await organizationService.updateOrganization('org-123', {
        name: 'New Name',
        slug: 'new-slug',
      });

      expect(org).not.toBeNull();
      expect(org?.name).toBe('New Name');
      expect(org?.slug).toBe('new-slug');
      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-123' },
        data: {
          name: 'New Name',
          slug: 'new-slug',
        },
      });
    });

    it('should return null if organization not found', async () => {
      // Simulate Prisma P2025 error (record not found)
      const error = new Error('Record not found');
      (error as any).code = 'P2025';
      mockPrisma.organization.update.mockRejectedValue(error);

      const org = await organizationService.updateOrganization('non-existent', {
        name: 'New Name',
      });

      expect(org).toBeNull();
    });

    it('should throw error for other database errors', async () => {
      const error = new Error('Database connection failed');
      mockPrisma.organization.update.mockRejectedValue(error);

      await expect(
        organizationService.updateOrganization('org-123', { name: 'New Name' }),
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('deleteOrganization', () => {
    it('should hard delete organization and invalidate subscription cache', async () => {
      mockPrisma.organization.delete.mockResolvedValue({ id: 'org-123' });

      const deleted = await organizationService.deleteOrganization('org-123');

      expect(deleted).toBe(true);
      expect(mockPrisma.organization.delete).toHaveBeenCalledWith({
        where: { id: 'org-123' },
      });
      expect(invalidateSubscriptionCacheMock).toHaveBeenCalledWith('org-123');
    });

    it('should return false when organization does not exist', async () => {
      const notFoundError = new Error('Record to delete does not exist') as Error & {
        code: string;
      };
      notFoundError.code = 'P2025';
      mockPrisma.organization.delete.mockRejectedValue(notFoundError);

      const deleted = await organizationService.deleteOrganization('missing-org');

      expect(deleted).toBe(false);
      expect(invalidateSubscriptionCacheMock).not.toHaveBeenCalled();
    });

    it('should throw for unexpected deletion errors', async () => {
      const dbError = new Error('Database unavailable');
      mockPrisma.organization.delete.mockRejectedValue(dbError);

      await expect(organizationService.deleteOrganization('org-123')).rejects.toThrow(
        'Database unavailable',
      );
    });
  });
});
