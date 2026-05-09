import { PrismaClient, Prisma } from '@prisma/client';
import { injectable, inject } from 'tsyringe';

type DbClient = PrismaClient | Prisma.TransactionClient;

@injectable()
export class AuditLogRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  private getClient(tx?: DbClient): DbClient {
    return tx ?? this.prisma;
  }

  async create(
    data: {
      organizationId: string;
      action: string;
      changeDescription: string;
      userId?: number | null;
      inventoryItemId?: number | null;
    },
    tx?: DbClient,
  ): Promise<void> {
    await this.getClient(tx).auditLog.create({
      data: {
        organizationId: data.organizationId,
        action: data.action,
        changeDescription: data.changeDescription,
        userId: data.userId ?? null,
        inventoryItemId: data.inventoryItemId ?? null,
      },
    });
  }
}
