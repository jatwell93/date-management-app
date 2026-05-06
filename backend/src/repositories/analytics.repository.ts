import { PrismaClient } from '@prisma/client';
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

@injectable()
export class AnalyticsRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  async createWebhookMetrics(data: {
    eventType: string;
    totalCount: number;
    failureCount: number;
    date: Date;
  }): Promise<any> {
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

  async createMetricsSnapshot(data: any): Promise<any> {
    return this.prisma.metricsSnapshot.create({
      data,
    });
  }

  async findLatestMetricsSnapshot(): Promise<any | null> {
    return this.prisma.metricsSnapshot.findFirst({
      orderBy: { date: 'desc' },
    });
  }

  async findMetricsSnapshotsSince(startDate: Date): Promise<any[]> {
    return this.prisma.metricsSnapshot.findMany({
      where: {
        date: {
          gte: startDate,
        },
      },
      orderBy: { date: 'asc' },
    });
  }

  async findMetricsSnapshotByDate(date: Date): Promise<any | null> {
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

  async findWebhookMetricsByDateRange(startDate: Date, endDate: Date): Promise<any[]> {
    return this.prisma.webhookMetrics.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
    });
  }

  async findWebhookMetricsSince(startDate: Date): Promise<any[]> {
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
}
