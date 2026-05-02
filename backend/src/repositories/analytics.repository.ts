import { PrismaClient } from '@prisma/client';
import { injectable, inject } from 'tsyringe';

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
}
