import { PrismaClient, Prisma, Product } from '@prisma/client';
import { injectable, inject } from 'tsyringe';

type ProductWithCount = Product & { _count: { inventoryItems: number } };

type DbClient = PrismaClient | Prisma.TransactionClient;

@injectable()
export class ProductRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) { }

  private getClient(tx?: DbClient): DbClient {
    return tx ?? this.prisma;
  }

  async findAll(
    organizationId: string,
    limit?: number,
    offset?: number,
    tx?: DbClient,
  ): Promise<Product[]> {
    return this.getClient(tx).product.findMany({
      where: { organizationId },
      ...(limit !== undefined && { take: limit }),
      ...(offset !== undefined && { skip: offset }),
    });
  }

  async findById(id: number, organizationId: string, tx?: DbClient): Promise<Product | null> {
    return this.getClient(tx).product.findUnique({
      where: {
        id,
        organizationId,
      },
    });
  }

  async findByBarcode(barcode: string, organizationId: string, tx?: DbClient): Promise<Product | null> {
    return this.getClient(tx).product.findUnique({
      where: {
        organizationId_barcode: {
          organizationId,
          barcode,
        },
      },
    });
  }

  async findBySku(sku: string, organizationId: string, tx?: DbClient): Promise<Product | null> {
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
  ): Promise<{ bySku: Product | null; byBarcode: Product | null }> {
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

  async create(data: Prisma.ProductUncheckedCreateInput, tx?: DbClient): Promise<Product> {
    return this.getClient(tx).product.create({
      data,
    });
  }

  async update(id: number, organizationId: string, data: Prisma.ProductUncheckedUpdateInput, tx?: DbClient): Promise<Product> {
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

  async findExcessProductsByOrganization(
    organizationId: string,
    maxSkus: number,
    tx?: DbClient,
  ): Promise<ProductWithCount[]> {
    return this.getClient(tx).product.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      skip: maxSkus,
      include: {
        _count: {
          select: { inventoryItems: true },
        },
      },
    }) as Promise<ProductWithCount[]>;
  }
}
