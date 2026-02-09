import { PrismaClient } from './generated/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { StoreArea } from '../models/store-area.model';

export class StoreAreaService {
  private prisma: PrismaClient;

  /**
   * Constructor with optional dependency injection
   * @param prismaClient - Optional PrismaClient for testing/custom configurations
   */
  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
  }

  async getAllStoreAreas(): Promise<StoreArea[]> {
    const results = await this.prisma.storeArea.findMany({
      orderBy: { name: 'asc' },
    });
    return results.map(this.mapPrismaToModel);
  }

  async getStoreAreaById(id: number): Promise<StoreArea | null> {
    const result = await this.prisma.storeArea.findUnique({
      where: { id },
    });
    return result ? this.mapPrismaToModel(result) : null;
  }

  async getStoreAreaByName(name: string): Promise<StoreArea[]> {
    const results = await this.prisma.storeArea.findMany({
      where: { name },
    });
    return results.map(this.mapPrismaToModel);
  }

  async getStoreAreaByNameAndSubDepartment(
    name: string,
    subDepartment: string | null,
  ): Promise<StoreArea | null> {
    const result = await this.prisma.storeArea.findFirst({
      where: {
        name,
        subDepartment: subDepartment ?? null,
      },
    });
    return result ? this.mapPrismaToModel(result) : null;
  }

  async createStoreArea(
    area: Omit<StoreArea, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<StoreArea> {
    // Check if a store area with the same name and subDepartment already exists
    const existingArea = await this.getStoreAreaByNameAndSubDepartment(
      area.name,
      area.subDepartment || null,
    );
    if (existingArea) {
      throw new Error('A store area with this name and sub-department combination already exists');
    }

    const newArea = await this.prisma.storeArea.create({
      data: {
        name: area.name,
        subDepartment: area.subDepartment || null,
        lastChecked: area.lastChecked ? new Date(area.lastChecked) : null,
      },
    });

    return this.mapPrismaToModel(newArea);
  }

  async updateStoreArea(
    id: number,
    area: Partial<Omit<StoreArea, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<StoreArea | null> {
    if (Object.keys(area).length === 0) {
      return null;
    }

    try {
      const updatedArea = await this.prisma.storeArea.update({
        where: { id },
        data: {
          ...(area.name !== undefined && { name: area.name }),
          ...(area.subDepartment !== undefined && { subDepartment: area.subDepartment || null }),
          ...(area.lastChecked !== undefined && {
            lastChecked: area.lastChecked ? new Date(area.lastChecked) : null,
          }),
        },
      });

      return this.mapPrismaToModel(updatedArea);
    } catch (error: any) {
      // Prisma throws P2025 when record not found
      if (error.code === 'P2025') {
        return null;
      }
      throw error;
    }
  }

  async deleteStoreArea(id: number): Promise<boolean> {
    try {
      await this.prisma.storeArea.delete({
        where: { id },
      });
      return true;
    } catch (error: any) {
      // Prisma throws P2025 when record not found
      if (error.code === 'P2025') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Map Prisma model to legacy StoreArea interface
   */
  private mapPrismaToModel(area: {
    id: number;
    name: string;
    subDepartment: string | null;
    lastChecked: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): StoreArea {
    return {
      id: area.id,
      name: area.name,
      subDepartment: area.subDepartment ?? undefined,
      lastChecked: area.lastChecked?.toISOString() ?? undefined,
      createdAt: area.createdAt.toISOString(),
      updatedAt: area.updatedAt.toISOString(),
    };
  }
}
