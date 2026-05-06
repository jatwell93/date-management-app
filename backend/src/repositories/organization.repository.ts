import { Prisma, PrismaClient } from '@prisma/client';
import { injectable, inject } from 'tsyringe';
import { Organization } from '../models/organization.model';

type OrganizationRecord = Prisma.OrganizationGetPayload<Record<string, never>>;
type OrganizationUpdate = Partial<Pick<Organization, 'name' | 'slug'>>;

@injectable()
export class OrganizationRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  async findById(id: string): Promise<OrganizationRecord | null> {
    return this.prisma.organization.findUnique({
      where: { id },
    });
  }

  async findCreationLockById(id: string): Promise<{ isCreationLocked: boolean } | null> {
    return this.prisma.organization.findUnique({
      where: { id },
      select: { isCreationLocked: true },
    });
  }

  async update(id: string, updates: OrganizationUpdate): Promise<OrganizationRecord> {
    return this.prisma.organization.update({
      where: { id },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.slug !== undefined && { slug: updates.slug }),
      },
    });
  }

  async deleteCascade(id: string): Promise<void> {
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
  }
}
