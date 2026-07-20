import {
  PrismaClient,
  Prisma,
  SubscriptionTier,
  OrganizationUsage,
  TierFeatureFlag,
} from '@prisma/client';
import { injectable, inject } from 'tsyringe';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface TierFeatureFlagSeedParams {
  tierLevel: string;
  featureKey: string;
  enabled: boolean;
  limitValue: number | null;
}

export interface SubscriptionTierStatusCount {
  tierLevel: string;
  status: string;
  _count: number;
}

export interface StripeLinkedSubscription {
  id: number;
  organizationId: string;
  stripeSubscriptionId: string | null;
  tierLevel: string;
  status: string;
}

export interface StripeSubscriptionSyncUpdate {
  tierLevel: string;
  status: string;
  trialEndDate: Date | null;
}

@injectable()
export class SubscriptionRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  private getClient(tx?: DbClient): DbClient {
    return tx ?? this.prisma;
  }

  async findByOrganizationId(
    organizationId: string,
    tx?: DbClient,
  ): Promise<SubscriptionTier | null> {
    return this.getClient(tx).subscriptionTier.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findLatestByOrganizationId(
    organizationId: string,
    tx?: DbClient,
  ): Promise<SubscriptionTier | null> {
    return this.findByOrganizationId(organizationId, tx);
  }

  async create(
    data: Prisma.SubscriptionTierUncheckedCreateInput,
    tx?: DbClient,
  ): Promise<SubscriptionTier> {
    return this.getClient(tx).subscriptionTier.create({
      data,
    });
  }

  async update(
    id: number,
    data: Prisma.SubscriptionTierUpdateInput,
    tx?: DbClient,
  ): Promise<SubscriptionTier> {
    return this.getClient(tx).subscriptionTier.update({
      where: { id },
      data,
    });
  }

  async updateManyByOrganizationId(
    organizationId: string,
    data: Prisma.SubscriptionTierUpdateInput,
    tx?: DbClient,
  ): Promise<{ count: number }> {
    return this.getClient(tx).subscriptionTier.updateMany({
      where: { organizationId },
      data,
    });
  }

  async updateStripeCustomerId(
    id: number,
    stripeCustomerId: string,
    tx?: DbClient,
  ): Promise<SubscriptionTier> {
    return this.update(id, { stripeCustomerId }, tx);
  }

  async groupSubscriptionCountsByTierAndStatus(): Promise<SubscriptionTierStatusCount[]> {
    const groupByTierAndStatus = this.prisma.subscriptionTier.groupBy as unknown as (args: {
      by: ['tierLevel', 'status'];
      _count: true;
    }) => Promise<SubscriptionTierStatusCount[]>;

    return groupByTierAndStatus({
      by: ['tierLevel', 'status'],
      _count: true,
    });
  }

  async findStripeLinkedSubscriptions(): Promise<StripeLinkedSubscription[]> {
    return this.prisma.subscriptionTier.findMany({
      where: {
        stripeSubscriptionId: { not: null },
      },
      select: {
        id: true,
        organizationId: true,
        stripeSubscriptionId: true,
        tierLevel: true,
        status: true,
      },
    });
  }

  async updateByStripeSubscriptionId(
    stripeSubscriptionId: string,
    data: StripeSubscriptionSyncUpdate,
  ): Promise<{ count: number }> {
    return this.prisma.subscriptionTier.updateMany({
      where: { stripeSubscriptionId },
      data,
    });
  }

  async findUsageByOrganizationId(
    organizationId: string,
    tx?: DbClient,
  ): Promise<OrganizationUsage | null> {
    return this.getClient(tx).organizationUsage.findUnique({
      where: { organizationId },
    });
  }

  async countActiveExpiryItems(organizationId: string, tx?: DbClient): Promise<number> {
    return this.getClient(tx).inventoryItem.count({
      where: {
        organizationId,
        status: {
          notIn: ['Processed', 'Completed', 'Discarded', 'Archived', 'Sold Through'],
        },
      },
    });
  }

  async findPastDueExpired(
    cutoffDate: Date,
    tx?: DbClient,
  ): Promise<Array<{ id: number; organizationId: string; pastDueSince: Date | null }>> {
    return this.getClient(tx).subscriptionTier.findMany({
      where: {
        status: 'past_due',
        pastDueSince: { lte: cutoffDate },
      },
      select: {
        id: true,
        organizationId: true,
        pastDueSince: true,
      },
    });
  }

  async findTrialingExpiringBefore(
    beforeDate: Date,
    afterDate: Date,
    tx?: DbClient,
  ): Promise<
    Array<{
      id: number;
      organizationId: string;
      trialEndDate: Date | null;
      organization: { id: string; name: string; contactEmail: string | null };
    }>
  > {
    return this.getClient(tx).subscriptionTier.findMany({
      where: {
        status: 'trialing',
        trialEndDate: {
          gte: afterDate,
          lte: beforeDate,
        },
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            contactEmail: true,
          },
        },
      },
    });
  }

  async findTrialingByOrganizationId(
    organizationId: string,
    tx?: DbClient,
  ): Promise<SubscriptionTier | null> {
    return this.getClient(tx).subscriptionTier.findFirst({
      where: {
        organizationId,
        status: 'trialing',
      },
    });
  }

  async findExpiredTrials(
    beforeDate: Date,
    tx?: DbClient,
  ): Promise<Array<{ id: number; organizationId: string }>> {
    return this.getClient(tx).subscriptionTier.findMany({
      where: {
        status: 'trialing',
        trialEndDate: { lt: beforeDate },
      },
      select: {
        id: true,
        organizationId: true,
      },
    });
  }

  async getOrCreateUsage(organizationId: string, tx?: DbClient): Promise<OrganizationUsage> {
    return this.getClient(tx).organizationUsage.upsert({
      where: { organizationId },
      create: {
        organizationId,
        activeUsers: 0,
        maxUsers: 1,
        totalSkus: 0,
        maxSkus: 500,
        totalInventoryItems: 0,
        maxInventoryItems: 500,
        storageUsedBytes: 0,
      },
      update: {},
    });
  }

  async createUsage(
    data: Prisma.OrganizationUsageUncheckedCreateInput,
    tx?: DbClient,
  ): Promise<OrganizationUsage> {
    return this.getClient(tx).organizationUsage.create({
      data,
    });
  }

  async updateUsage(
    organizationId: string,
    data: Prisma.OrganizationUsageUpdateInput,
    tx?: DbClient,
  ): Promise<OrganizationUsage> {
    return this.getClient(tx).organizationUsage.update({
      where: { organizationId },
      data,
    });
  }

  async upsertUsage(
    organizationId: string,
    update: Prisma.OrganizationUsageUpdateInput,
    create: Prisma.OrganizationUsageUncheckedCreateInput,
    tx?: DbClient,
  ): Promise<OrganizationUsage> {
    return this.getClient(tx).organizationUsage.upsert({
      where: { organizationId },
      update,
      create,
    });
  }

  async updateManyByOrganizationIdAndStripeSubscriptionId(
    organizationId: string,
    stripeSubscriptionId: string,
    data: Prisma.SubscriptionTierUpdateInput,
    tx?: DbClient,
  ): Promise<{ count: number }> {
    return this.getClient(tx).subscriptionTier.updateMany({
      where: { organizationId, stripeSubscriptionId },
      data,
    });
  }

  async findTierFeatureFlag(
    tierLevel: string,
    featureKey: string,
  ): Promise<TierFeatureFlag | null> {
    return this.prisma.tierFeatureFlag.findUnique({
      where: {
        tierLevel_featureKey: {
          tierLevel,
          featureKey,
        },
      },
    });
  }

  async countTierFeatureFlags(): Promise<number> {
    return this.prisma.tierFeatureFlag.count();
  }

  async seedTierFeatureFlag(params: TierFeatureFlagSeedParams): Promise<{ seeded: boolean }> {
    const existing = await this.prisma.tierFeatureFlag.findUnique({
      where: {
        tierLevel_featureKey: {
          tierLevel: params.tierLevel,
          featureKey: params.featureKey,
        },
      },
      select: { id: true },
    });

    await this.prisma.tierFeatureFlag.upsert({
      where: {
        tierLevel_featureKey: {
          tierLevel: params.tierLevel,
          featureKey: params.featureKey,
        },
      },
      update: {},
      create: {
        tierLevel: params.tierLevel,
        featureKey: params.featureKey,
        enabled: params.enabled,
        limitValue: params.limitValue,
      },
    });

    return { seeded: !existing };
  }
}
