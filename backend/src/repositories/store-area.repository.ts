import { Prisma, PrismaClient } from '@prisma/client';
import { injectable, inject } from 'tsyringe';
import { StoreArea } from '../models/store-area.model';

type StoreAreaRecord = Prisma.StoreAreaGetPayload<Record<string, never>>;

@injectable()
export class StoreAreaRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  async findAll(organizationId: string): Promise<StoreAreaRecord[]> {
    return this.prisma.storeArea.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: number, organizationId: string): Promise<StoreAreaRecord | null> {
    return this.prisma.storeArea.findFirst({
      where: { id, organizationId },
    });
  }

  async findByName(name: string, organizationId: string): Promise<StoreAreaRecord[]> {
    return this.prisma.storeArea.findMany({
      where: { name, organizationId },
    });
  }

  async findByNameAndSubDepartment(
    name: string,
    subDepartment: string | null,
    organizationId: string,
  ): Promise<StoreAreaRecord | null> {
    return this.prisma.storeArea.findFirst({
      where: {
        name,
        subDepartment: subDepartment ?? null,
        organizationId,
      },
    });
  }

  async create(
    organizationId: string,
    area: Omit<StoreArea, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>,
  ): Promise<StoreAreaRecord> {
    return this.prisma.storeArea.create({
      data: {
        organizationId,
        name: area.name,
        subDepartment: area.subDepartment || null,
        lastChecked: area.lastChecked ? new Date(area.lastChecked) : null,
      },
    });
  }

  async update(
    id: number,
    area: Partial<Omit<StoreArea, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<StoreAreaRecord> {
    return this.prisma.storeArea.update({
      where: { id },
      data: {
        ...(area.name !== undefined && { name: area.name }),
        ...(area.subDepartment !== undefined && { subDepartment: area.subDepartment || null }),
        ...(area.lastChecked !== undefined && {
          lastChecked: area.lastChecked ? new Date(area.lastChecked) : null,
        }),
      },
    });
  }

  async delete(id: number): Promise<void> {
    await this.prisma.storeArea.delete({
      where: { id },
    });
  }
}
