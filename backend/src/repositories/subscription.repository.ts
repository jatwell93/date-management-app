import { PrismaClient, Prisma } from '@prisma/client';
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

  async findByOrganizationId(organizationId: string, tx?: DbClient): Promise<any | null> {
    return this.getClient(tx).subscriptionTier.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: any, tx?: DbClient): Promise<any> {
    return this.getClient(tx).subscriptionTier.create({
      data,
    });
  }

  async update(id: number, data: any, tx?: DbClient): Promise<any> {
    return this.getClient(tx).subscriptionTier.update({
      where: { id },
      data,
    });
  }

  async updateStripeCustomerId(id: number, stripeCustomerId: string, tx?: DbClient): Promise<any> {
    return this.update(id, { stripeCustomerId }, tx);
  }

  async groupSubscriptionCountsByTierAndStatus(): Promise<SubscriptionTierStatusCount[]> {
    return this.prisma.subscriptionTier.groupBy({
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

  async findUsageByOrganizationId(organizationId: string, tx?: DbClient): Promise<any | null> {
    return this.getClient(tx).organizationUsage.findUnique({
      where: { organizationId },
    });
  }

  async createUsage(data: any, tx?: DbClient): Promise<any> {
    return this.getClient(tx).organizationUsage.create({
      data,
    });
  }

  async updateUsage(organizationId: string, data: any, tx?: DbClient): Promise<any> {
    return this.getClient(tx).organizationUsage.update({
      where: { organizationId },
      data,
    });
  }

  async findTierFeatureFlag(tierLevel: string, featureKey: string): Promise<any | null> {
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
