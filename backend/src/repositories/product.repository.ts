import { PrismaClient, Prisma, Product } from '@prisma/client';
import { injectable, inject } from 'tsyringe';

type ProductWithCount = Product & { _count: { inventoryItems: number } };
const creditContextInclude = {
  supplier: true,
  brand: { include: { supplier: true } },
} satisfies Prisma.ProductInclude;
export type ProductWithCreditRelations = Prisma.ProductGetPayload<{
  include: typeof creditContextInclude;
}>;
export interface ProductIdentifierLookup {
  bySku: Product | null;
  byBarcode: Product | null;
}

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
  ): Promise<ProductWithCreditRelations[]> {
    // Include supplier/brand so mapPrismaToModel can resolve an accurate creditScope
    // on the GET /products list, matching findById/findByBarcode/findBySku. Without
    // this the list would emit a hardcoded NO_CREDIT for every product.
    return this.getClient(tx).product.findMany({
      where: { organizationId },
      include: creditContextInclude,
      ...(limit !== undefined && { take: limit }),
      ...(offset !== undefined && { skip: offset }),
    });
  }

  async findById(
    id: number,
    organizationId: string,
    tx?: DbClient,
  ): Promise<ProductWithCreditRelations | null> {
    return this.getClient(tx).product.findUnique({
      where: {
        id,
        organizationId,
      },
      include: creditContextInclude,
    });
  }

  async findByBarcode(
    barcode: string,
    organizationId: string,
    tx?: DbClient,
  ): Promise<ProductWithCreditRelations | null> {
    return this.getClient(tx).product.findFirst({
      where: { barcode, organizationId },
      include: creditContextInclude,
    });
  }

  async findBySku(
    sku: string,
    organizationId: string,
    tx?: DbClient,
  ): Promise<ProductWithCreditRelations | null> {
    return this.getClient(tx).product.findUnique({
      where: {
        organizationId_sku: {
          organizationId,
          sku,
        },
      },
      include: creditContextInclude,
    });
  }

  // Deliberately does NOT include supplier/brand relations: callers use this only to
  // resolve product identity (id/sku/barcode) during CSV/XLSX import, and the derived
  // creditScope is discarded. Adding credit-context joins to this per-row import
  // lookup would cost query time for a value nothing reads.
  async findBySkuOrBarcode(
    sku: string,
    barcode: string,
    organizationId: string,
    tx?: DbClient,
  ): Promise<ProductIdentifierLookup> {
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

    return {
      bySku,
      byBarcode,
    };
  }

  async findFirstBySkuOrBarcode(
    sku: string,
    barcode: string,
    organizationId: string,
    tx?: DbClient,
  ): Promise<Product | null> {
    const { bySku, byBarcode } = await this.findBySkuOrBarcode(sku, barcode, organizationId, tx);

    if (bySku && byBarcode && bySku.id !== byBarcode.id) {
      throw new Error(
        `Duplicate identifiers detected: SKU ${sku} exists in product ${bySku.id} and barcode ${barcode} exists in product ${byBarcode.id}. This will cause data integrity issues.`,
      );
    }

    return bySku ?? byBarcode;
  }

  async create(data: Prisma.ProductUncheckedCreateInput, tx?: DbClient): Promise<Product> {
    return this.getClient(tx).product.create({
      data,
    });
  }

  async update(
    id: number,
    organizationId: string,
    data: Prisma.ProductUncheckedUpdateInput,
    tx?: DbClient,
  ): Promise<Product> {
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
