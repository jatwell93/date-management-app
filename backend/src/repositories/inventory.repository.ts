import { PrismaClient } from '@prisma/client';
import { injectable, inject } from 'tsyringe';

@injectable()
export class InventoryRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  async findAll(organizationId: string): Promise<any[]> {
    return this.prisma.inventoryItem.findMany({
      where: { organizationId },
    });
  }

  async findById(id: number, organizationId: string): Promise<any | null> {
    return this.prisma.inventoryItem.findFirst({
      where: { id, organizationId },
    });
  }

  async findByProductId(productId: number, organizationId: string): Promise<any[]> {
    return this.prisma.inventoryItem.findMany({
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
  ): Promise<any[]> {
    return this.prisma.inventoryItem.findMany({
      where: {
        productId,
        organizationId,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async findByLocationId(locationId: number, organizationId: string): Promise<any[]> {
    return this.prisma.inventoryItem.findMany({
      where: {
        locationId,
        organizationId,
      },
    });
  }

  async create(data: any): Promise<any> {
    return this.prisma.inventoryItem.create({
      data,
    });
  }

  async update(id: number, organizationId: string, data: any): Promise<any> {
    return this.prisma.inventoryItem.update({
      where: {
        id,
        organizationId,
      },
      data,
    });
  }

  async delete(id: number, organizationId: string): Promise<void> {
    await this.prisma.inventoryItem.delete({
      where: {
        id,
        organizationId,
      },
    });
  }
}
