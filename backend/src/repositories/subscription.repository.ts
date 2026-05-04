import { PrismaClient, Prisma } from '@prisma/client';
import { injectable, inject } from 'tsyringe';

type DbClient = PrismaClient | Prisma.TransactionClient;

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
}
