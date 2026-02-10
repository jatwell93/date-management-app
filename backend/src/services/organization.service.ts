import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { Organization } from '../models/organization.model';

export class OrganizationService {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
  }

  /**
   * Get organization by ID
   */
  async getOrganization(id: string): Promise<Organization | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id },
    });
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
      const updated = await this.prisma.organization.update({
        where: { id },
        data: {
          ...(updates.name !== undefined && { name: updates.name }),
          ...(updates.slug !== undefined && { slug: updates.slug }),
        },
      });
      return this.mapPrismaToModel(updated);
    } catch (error: unknown) {
      if (
        error instanceof Object &&
        'code' in error &&
        (error as Record<string, unknown>).code === 'P2025'
      ) {
        return null; // Organization not found
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