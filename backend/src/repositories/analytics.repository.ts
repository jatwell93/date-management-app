import { Prisma, PrismaClient, MetricsSnapshot, WebhookMetrics } from '@prisma/client';
import { injectable, inject } from 'tsyringe';

export interface MetricsSnapshotInput {
  date: Date;
  trialConversionRate: number;
  avgRevenuePerUser: number;
  churnRate: number;
  totalTrials: number;
  totalConversions: number;
  totalChurn: number;
  totalRevenueCents: number;
  tierDistribution: Record<string, number>;
}

export type TrialConversionRecord = Pick<
  Prisma.SubscriptionTierGetPayload<Record<string, never>>,
  'status' | 'stripeSubscriptionId'
>;

export type SubscriptionTierLevelRecord = Pick<
  Prisma.SubscriptionTierGetPayload<Record<string, never>>,
  'tierLevel'
>;

export type SubscriptionTierDistributionRecord = {
  tierLevel: string;
  _count: number;
};

@injectable()
export class AnalyticsRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  async createWebhookMetrics(data: {
    eventType: string;
    totalCount: number;
    failureCount: number;
    date: Date;
  }): Promise<WebhookMetrics> {
    return this.prisma.webhookMetrics.upsert({
      where: {
        eventType_date: {
          eventType: data.eventType,
          date: data.date,
        },
      },
      update: {
        totalCount: { increment: data.totalCount },
        failureCount: { increment: data.failureCount },
      },
      create: {
        eventType: data.eventType,
        totalCount: data.totalCount,
        failureCount: data.failureCount,
        date: data.date,
      },
    });
  }

  async createMetricsSnapshot(data: Prisma.MetricsSnapshotCreateInput): Promise<MetricsSnapshot> {
    return this.prisma.metricsSnapshot.create({
      data,
    });
  }

  async findLatestMetricsSnapshot(): Promise<MetricsSnapshot | null> {
    return this.prisma.metricsSnapshot.findFirst({
      orderBy: { date: 'desc' },
    });
  }

  async findMetricsSnapshotsSince(startDate: Date): Promise<MetricsSnapshot[]> {
    return this.prisma.metricsSnapshot.findMany({
      where: {
        date: {
          gte: startDate,
        },
      },
      orderBy: { date: 'asc' },
    });
  }

  async findMetricsSnapshotByDate(date: Date): Promise<MetricsSnapshot | null> {
    return this.prisma.metricsSnapshot.findUnique({
      where: { date },
    });
  }

  async upsertMetricsSnapshot(snapshot: MetricsSnapshotInput): Promise<void> {
    const data = {
      ...snapshot,
      tierDistribution: JSON.stringify(snapshot.tierDistribution),
    };

    await this.prisma.metricsSnapshot.upsert({
      where: { date: snapshot.date },
      update: data,
      create: data,
    });
  }

  async findWebhookMetricsByDateRange(startDate: Date, endDate: Date): Promise<WebhookMetrics[]> {
    return this.prisma.webhookMetrics.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
    });
  }

  async findWebhookMetricsSince(startDate: Date): Promise<WebhookMetrics[]> {
    return this.prisma.webhookMetrics.findMany({
      where: {
        date: {
          gte: startDate,
        },
      },
    });
  }

  async countProcessedWebhookEventsBetween(startDate: Date, endDate: Date): Promise<number> {
    return this.prisma.processedWebhookEvent.count({
      where: {
        processedAt: {
          gte: startDate,
          lt: endDate,
        },
      },
    });
  }

  async incrementWebhookMetrics(eventType: string, success: boolean, date: Date): Promise<void> {
    await this.prisma.webhookMetrics.upsert({
      where: {
        eventType_date: {
          eventType,
          date,
        },
      },
      update: {
        totalCount: { increment: 1 },
        failureCount: success ? undefined : { increment: 1 },
      },
      create: {
        eventType,
        date,
        totalCount: 1,
        failureCount: success ? 0 : 1,
      },
    });
  }

  async findTrialsEndedBetween(startDate: Date, endDate: Date): Promise<TrialConversionRecord[]> {
    return this.prisma.subscriptionTier.findMany({
      where: {
        trialEndDate: {
          lte: endDate,
          gte: startDate,
        },
      },
      select: {
        stripeSubscriptionId: true,
        status: true,
      },
    });
  }

  async findActivePaidSubscriptionTierLevels(): Promise<SubscriptionTierLevelRecord[]> {
    return this.prisma.subscriptionTier.findMany({
      where: {
        status: 'active',
        stripeSubscriptionId: { not: null },
      },
      select: {
        tierLevel: true,
      },
    });
  }

  async sumActiveOrganizationUsers(): Promise<number> {
    const activeUsers = await this.prisma.organizationUsage.aggregate({
      _sum: { activeUsers: true },
    });

    return activeUsers._sum.activeUsers ?? 0;
  }

  async countActiveSubscriptions(): Promise<number> {
    return this.prisma.subscriptionTier.count({
      where: { status: 'active' },
    });
  }

  async countActiveSubscriptionsCreatedSince(startDate: Date): Promise<number> {
    return this.prisma.subscriptionTier.count({
      where: {
        status: 'active',
        createdAt: { gte: startDate },
      },
    });
  }

  async countCanceledSubscriptionsUpdatedSince(startDate: Date): Promise<number> {
    return this.prisma.subscriptionTier.count({
      where: {
        status: 'canceled',
        updatedAt: { gte: startDate },
      },
    });
  }

  async groupSubscriptionTiersByTierLevel(): Promise<SubscriptionTierDistributionRecord[]> {
    const groupByTierLevel = this.prisma.subscriptionTier.groupBy as unknown as (args: {
      by: ['tierLevel'];
      _count: true;
    }) => Promise<SubscriptionTierDistributionRecord[]>;

    return groupByTierLevel({
      by: ['tierLevel'],
      _count: true,
    });
  }

  async countTrialsEndingSince(startDate: Date): Promise<number> {
    return this.prisma.subscriptionTier.count({
      where: {
        trialEndDate: { gte: startDate },
      },
    });
  }

  async countPaidSubscriptionsCreatedSince(startDate: Date): Promise<number> {
    return this.prisma.subscriptionTier.count({
      where: {
        stripeSubscriptionId: { not: null },
        createdAt: { gte: startDate },
      },
    });
  }
}
