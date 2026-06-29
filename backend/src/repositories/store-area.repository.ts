import { Prisma, PrismaClient } from '@prisma/client';
import { injectable, inject } from 'tsyringe';
import { StoreArea } from '../models/store-area.model';

type StoreAreaRecord = Prisma.StoreAreaGetPayload<Record<string, never>>;
type DbClient = PrismaClient | Prisma.TransactionClient;

@injectable()
export class StoreAreaRepository {
  constructor(@inject(PrismaClient) private prisma: PrismaClient) {}

  private getClient(tx?: DbClient): DbClient {
    return tx ?? this.prisma;
  }

  async findAll(organizationId: string, tx?: DbClient): Promise<StoreAreaRecord[]> {
    return this.getClient(tx).storeArea.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
  }

  async findById(
    id: number,
    organizationId: string,
    tx?: DbClient,
  ): Promise<StoreAreaRecord | null> {
    return this.getClient(tx).storeArea.findFirst({
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

  async getOrCreateByName(
    name: string,
    organizationId: string,
    tx?: DbClient,
  ): Promise<{ id: number }> {
    const existing = await this.getClient(tx).storeArea.findFirst({
      where: { name, organizationId },
      select: { id: true },
    });

    if (existing) {
      return existing;
    }

    const created = await this.getClient(tx).storeArea.create({
      data: {
        organizationId,
        name,
        subDepartment: null,
      },
      select: { id: true },
    });

    return created;
  }

  async findByNameAndSubDepartmentWithTransaction(
    name: string,
    subDepartment: string,
    organizationId: string,
    tx: DbClient,
  ): Promise<StoreAreaRecord | null> {
    return this.getClient(tx).storeArea.findUnique({
      where: {
        organizationId_name_subDepartment: {
          organizationId,
          name,
          subDepartment,
        },
      },
    });
  }

  async createWithTransaction(
    organizationId: string,
    name: string,
    subDepartment: string,
    tx: DbClient,
  ): Promise<StoreAreaRecord> {
    return this.getClient(tx).storeArea.create({
      data: { organizationId, name, subDepartment },
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
