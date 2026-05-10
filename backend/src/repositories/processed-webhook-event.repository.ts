import { PrismaClient, Prisma } from '@prisma/client';
import { injectable, inject } from 'tsyringe';

type DbClient = PrismaClient | Prisma.TransactionClient;

@injectable()
export class ProcessedWebhookEventRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  private getClient(tx?: DbClient): DbClient {
    return tx ?? this.prisma;
  }

  async findById(
    id: string,
    tx?: DbClient,
  ): Promise<{ id: string; eventType: string; processedAt: Date } | null> {
    return this.getClient(tx).processedWebhookEvent.findUnique({
      where: { id },
    });
  }

  async create(id: string, eventType: string, tx?: DbClient): Promise<void> {
    await this.getClient(tx).processedWebhookEvent.create({
      data: {
        id,
        eventType,
        processedAt: new Date(),
      },
    });
  }
}
