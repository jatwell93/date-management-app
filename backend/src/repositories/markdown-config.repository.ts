import { Prisma, PrismaClient } from '@prisma/client';
import { injectable, inject } from 'tsyringe';

type MarkdownConfigRecord = Prisma.OrganizationMarkdownConfigGetPayload<Record<string, never>>;
type DbClient = PrismaClient | Prisma.TransactionClient;

export interface MarkdownConfigWriteData {
  band1Percentage: number;
  band2Percentage: number;
  band3Percentage: number;
  band1Basis: string;
  band2Basis: string;
  band3Basis: string;
}

@injectable()
export class MarkdownConfigRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  private getClient(tx?: DbClient): DbClient {
    return tx ?? this.prisma;
  }

  async findByOrganizationId(
    organizationId: string,
    tx?: DbClient,
  ): Promise<MarkdownConfigRecord | null> {
    return this.getClient(tx).organizationMarkdownConfig.findUnique({
      where: { organizationId },
    });
  }

  async upsert(
    organizationId: string,
    data: MarkdownConfigWriteData,
    tx?: DbClient,
  ): Promise<MarkdownConfigRecord> {
    return this.getClient(tx).organizationMarkdownConfig.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
  }

  /**
   * Whether the organization has any product carrying a retail price. Retail-basis
   * bands are only offered once this is true (issue #338).
   */
  async hasRetailData(organizationId: string, tx?: DbClient): Promise<boolean> {
    const count = await this.getClient(tx).product.count({
      where: { organizationId, retailPrice: { not: null } },
    });
    return count > 0;
  }
}
