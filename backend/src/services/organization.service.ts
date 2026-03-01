import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { Organization } from '../models/organization.model';
import { invalidateSubscriptionCache } from '../middleware/auth.middleware';
import { isPrismaErrorCode, PRISMA_ERROR_CODES } from '../utils/prisma-error';

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
   * Hard delete organization and all related data via schema cascades.
   * Returns false when the organization does not exist.
   */
  async deleteOrganization(id: string): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const users = await tx.user.findMany({
          where: { organizationId: id },
          select: { id: true },
        });
        const userIds = users.map((user) => user.id);

        await tx.auditLog.deleteMany({ where: { organizationId: id } });
        await tx.itemTransaction.deleteMany({ where: { organizationId: id } });
        await tx.expiredItemTransaction.deleteMany({ where: { organizationId: id } });
        await tx.upload.deleteMany({ where: { organizationId: id } });
        await tx.organizationInvite.deleteMany({ where: { organizationId: id } });
        if (userIds.length > 0) {
          await tx.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
        }

        await tx.inventoryItem.deleteMany({ where: { organizationId: id } });
        await tx.storeArea.deleteMany({ where: { organizationId: id } });
        await tx.product.deleteMany({ where: { organizationId: id } });
        await tx.subscriptionTier.deleteMany({ where: { organizationId: id } });
        await tx.trialEvent.deleteMany({ where: { organizationId: id } });
        await tx.organizationUsage.deleteMany({ where: { organizationId: id } });
        await tx.user.deleteMany({ where: { organizationId: id } });

        await tx.organization.delete({
          where: { id },
        });
      });

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
