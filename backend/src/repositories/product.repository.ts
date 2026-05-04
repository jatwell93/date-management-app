import { PrismaClient, Prisma } from '@prisma/client';
import { injectable, inject } from 'tsyringe';

type DbClient = PrismaClient | Prisma.TransactionClient;

@injectable()
export class ProductRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  private getClient(tx?: DbClient): DbClient {
    return tx ?? this.prisma;
  }

  async findAll(
    organizationId: string,
    limit?: number,
    offset?: number,
    tx?: DbClient,
  ): Promise<any[]> {
    return this.getClient(tx).product.findMany({
      where: { organizationId },
      ...(limit !== undefined && { take: limit }),
      ...(offset !== undefined && { skip: offset }),
    });
  }

  async findById(id: number, organizationId: string, tx?: DbClient): Promise<any | null> {
    return this.getClient(tx).product.findUnique({
      where: {
        id,
        organizationId,
      },
    });
  }

  async findByBarcode(barcode: string, organizationId: string, tx?: DbClient): Promise<any | null> {
    return this.getClient(tx).product.findUnique({
      where: {
        organizationId_barcode: {
          organizationId,
          barcode,
        },
      },
    });
  }

  async findBySku(sku: string, organizationId: string, tx?: DbClient): Promise<any | null> {
    return this.getClient(tx).product.findUnique({
      where: {
        organizationId_sku: {
          organizationId,
          sku,
        },
      },
    });
  }

  async findBySkuOrBarcode(
    sku: string,
    barcode: string,
    organizationId: string,
    tx?: DbClient,
  ): Promise<{ bySku: any | null; byBarcode: any | null }> {
    const client = this.getClient(tx);
    const bySku = await client.product.findUnique({
      where: {
        organizationId_sku: {
          organizationId,
          sku,
        },
      },
    });
    const byBarcode = await client.product.findUnique({
      where: {
        organizationId_barcode: {
          organizationId,
          barcode,
        },
      },
    });

    return { bySku, byBarcode };
  }

  async create(data: any, tx?: DbClient): Promise<any> {
    return this.getClient(tx).product.create({
      data,
    });
  }

  async update(id: number, organizationId: string, data: any, tx?: DbClient): Promise<any> {
    return this.getClient(tx).product.update({
      where: {
        id,
        organizationId,
      },
      data,
    });
  }

  async delete(id: number, organizationId: string, tx?: DbClient): Promise<void> {
    await this.getClient(tx).product.delete({
      where: {
        id,
        organizationId,
      },
    });
  }

  async countByOrganization(organizationId: string, tx?: DbClient): Promise<number> {
    return this.getClient(tx).product.count({
      where: { organizationId },
    });
  }
}
