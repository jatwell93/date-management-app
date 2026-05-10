import { PrismaClient, Prisma } from '@prisma/client';
import { injectable, inject } from 'tsyringe';

type DbClient = PrismaClient | Prisma.TransactionClient;

@injectable()
export class TrialEventRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  private getClient(tx?: DbClient): DbClient {
    return tx ?? this.prisma;
  }

  async create(
    data: {
      organizationId: string;
      eventType: string;
      metadata?: string;
      occurredAt?: Date;
    },
    tx?: DbClient,
  ): Promise<void> {
    await this.getClient(tx).trialEvent.create({
      data: {
        organizationId: data.organizationId,
        eventType: data.eventType,
        metadata: data.metadata ?? null,
        occurredAt: data.occurredAt ?? new Date(),
      },
    });
  }

  async findRecentByOrganizationAndType(
    organizationId: string,
    eventType: string,
    since: Date,
    tx?: DbClient,
  ): Promise<{ id: string; organizationId: string; eventType: string; occurredAt: Date } | null> {
    return this.getClient(tx).trialEvent.findFirst({
      where: {
        organizationId,
        eventType,
        occurredAt: { gte: since },
      },
    });
  }

  async findRecentByType(
    eventType: string,
    since: Date,
    tx?: DbClient,
  ): Promise<
    Array<{
      id: string;
      organizationId: string;
      eventType: string;
      occurredAt: Date;
      metadata: string | null;
    }>
  > {
    return this.getClient(tx).trialEvent.findMany({
      where: {
        eventType,
        occurredAt: { gte: since },
      },
      orderBy: { occurredAt: 'desc' },
    });
  }
}
