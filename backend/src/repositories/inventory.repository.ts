import { PrismaClient, Prisma, InventoryItem } from '@prisma/client';
import { injectable, inject } from 'tsyringe';

type DbClient = PrismaClient | Prisma.TransactionClient;

@injectable()
export class InventoryRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  private getClient(tx?: DbClient): DbClient {
    return tx ?? this.prisma;
  }

  async findAll(organizationId: string, tx?: DbClient): Promise<InventoryItem[]> {
    return this.getClient(tx).inventoryItem.findMany({
      where: { organizationId },
    });
  }

  async findById(id: number, organizationId: string, tx?: DbClient): Promise<InventoryItem | null> {
    return this.getClient(tx).inventoryItem.findFirst({
      where: { id, organizationId },
    });
  }

  async findByProductId(
    productId: number,
    organizationId: string,
    tx?: DbClient,
  ): Promise<InventoryItem[]> {
    return this.getClient(tx).inventoryItem.findMany({
      where: {
        productId,
        organizationId,
      },
    });
  }

  async findRecentByProductId(
    productId: number,
    organizationId: string,
    limit: number,
    tx?: DbClient,
  ): Promise<InventoryItem[]> {
    return this.getClient(tx).inventoryItem.findMany({
      where: {
        productId,
        organizationId,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async findByLocationId(
    locationId: number,
    organizationId: string,
    tx?: DbClient,
  ): Promise<InventoryItem[]> {
    return this.getClient(tx).inventoryItem.findMany({
      where: {
        locationId,
        organizationId,
      },
    });
  }

  async findFirst(
    where: Prisma.InventoryItemWhereInput,
    tx?: DbClient,
  ): Promise<InventoryItem | null> {
    return this.getClient(tx).inventoryItem.findFirst({
      where,
    });
  }

  async create(
    data: Prisma.InventoryItemUncheckedCreateInput,
    tx?: DbClient,
  ): Promise<InventoryItem> {
    return this.getClient(tx).inventoryItem.create({
      data,
    });
  }

  async update(
    id: number,
    organizationId: string,
    data: Prisma.InventoryItemUncheckedUpdateInput,
    tx?: DbClient,
  ): Promise<InventoryItem> {
    return this.getClient(tx).inventoryItem.update({
      where: {
        id,
        organizationId,
      },
      data,
    });
  }

  async delete(id: number, organizationId: string, tx?: DbClient): Promise<void> {
    await this.getClient(tx).inventoryItem.delete({
      where: {
        id,
        organizationId,
      },
    });
  }

  async findByOrganizationIdAndId(
    id: number,
    organizationId: string,
    tx?: DbClient,
  ): Promise<InventoryItem | null> {
    return this.getClient(tx).inventoryItem.findFirst({
      where: { id, organizationId },
    });
  }

  async findManyByIds(
    ids: number[],
    organizationId: string,
    tx?: DbClient,
  ): Promise<Array<{ id: number }>> {
    return this.getClient(tx).inventoryItem.findMany({
      where: {
        id: { in: ids },
        organizationId,
      },
      select: { id: true },
    });
  }

  async findUniqueWithProduct(
    id: number,
    organizationId: string,
    tx?: DbClient,
  ): Promise<
    (InventoryItem & { product: { costPrice: number | null; retailPrice: number | null } }) | null
  > {
    return this.getClient(tx).inventoryItem.findUnique({
      where: { id, organizationId },
      include: {
        product: {
          select: { costPrice: true, retailPrice: true },
        },
      },
    }) as Promise<
      (InventoryItem & { product: { costPrice: number | null; retailPrice: number | null } }) | null
    >;
  }

  async updateManyByIds(
    items: Array<{ id: number; status: string }>,
    tx?: DbClient,
  ): Promise<InventoryItem[]> {
    return Promise.all(
      items.map((item) =>
        this.getClient(tx).inventoryItem.update({
          where: { id: item.id },
          data: { status: item.status },
        }),
      ),
    );
  }
}
