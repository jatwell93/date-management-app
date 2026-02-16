import { OrganizationService } from '../../services/organization.service';
import { PrismaClient } from '@prisma/client';

describe('OrganizationService', () => {
  let organizationService: OrganizationService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      organization: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
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
});
