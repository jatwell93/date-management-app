import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { Organization } from '../models/organization.model';
import { OrganizationRepository } from '../repositories/organization.repository';
import { invalidateSubscriptionCache } from '../middleware/auth.middleware';
import { isPrismaErrorCode, PRISMA_ERROR_CODES } from '../utils/prisma-error';

export class OrganizationService {
  private prisma: PrismaClient;
  private organizationRepo: OrganizationRepository;

  constructor(prismaClient?: PrismaClient, organizationRepo?: OrganizationRepository) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.organizationRepo = organizationRepo ?? new OrganizationRepository(this.prisma);
  }

  /**
   * Get organization by ID
   */
  async getOrganization(id: string): Promise<Organization | null> {
    const org = await this.organizationRepo.findById(id);
    return org ? this.mapPrismaToModel(org) : null;
  }

  /**
   * Update organization details
   */
  async updateOrganization(
    id: string,
    updates: Partial<Pick<Organization, 'name' | 'slug'>>,
  ): Promise<Organization | null> {
    try {
      const updated = await this.organizationRepo.update(id, updates);
      return this.mapPrismaToModel(updated);
    } catch (error: unknown) {
      if (isPrismaErrorCode(error, PRISMA_ERROR_CODES.NOT_FOUND)) {
        return null; // Organization not found
      }
      throw error;
    }
  }

  /**
   * Hard delete organization and all related data via schema cascades.
   * Returns false when the organization does not exist.
   */
  async deleteOrganization(id: string): Promise<boolean> {
    try {
      await this.organizationRepo.deleteCascade(id);

      // Ensure auth middleware does not serve stale tier data for deleted org
      invalidateSubscriptionCache(id);
      return true;
    } catch (error: unknown) {
      if (isPrismaErrorCode(error, PRISMA_ERROR_CODES.NOT_FOUND)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Map Prisma model to Organization interface
   */
  private mapPrismaToModel(org: {
    id: string;
    name: string;
    slug: string;
    createdAt: Date;
    updatedAt: Date;
  }): Organization {
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    };
  }
}
