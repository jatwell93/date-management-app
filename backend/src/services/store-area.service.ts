import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { StoreArea } from '../models/store-area.model';
import { getOrganizationId } from '../utils/auth-bypass';
import { isPrismaNotFound } from '../utils/prisma-error';

export class StoreAreaService {
  private prisma: PrismaClient;
  private organizationId: string;

  /**
   * Constructor with optional dependency injection
   * @param organizationId - Organization ID for tenant filtering (optional in tests)
   * @param prismaClient - Optional PrismaClient for testing/custom configurations
   */
  constructor(organizationId?: string, prismaClient?: PrismaClient) {
    this.organizationId = getOrganizationId(organizationId);
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
  }

  async getAllStoreAreas(): Promise<StoreArea[]> {
    const results = await this.prisma.storeArea.findMany({
      where: { organizationId: this.organizationId },
      orderBy: { name: 'asc' },
    });
    return results.map(this.mapPrismaToModel);
  }

  async getStoreAreaById(id: number): Promise<StoreArea | null> {
    const result = await this.prisma.storeArea.findFirst({
      where: { id, organizationId: this.organizationId },
    });
    return result ? this.mapPrismaToModel(result) : null;
  }

  async getStoreAreaByName(name: string): Promise<StoreArea[]> {
    const results = await this.prisma.storeArea.findMany({
      where: { name, organizationId: this.organizationId },
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
        organizationId: this.organizationId,
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
        organizationId: this.organizationId,
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
    } catch (error: unknown) {
      // Prisma throws P2025 when record not found
      if (isPrismaNotFound(error)) {
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
    } catch (error: unknown) {
      // Prisma throws P2025 when record not found
      if (isPrismaNotFound(error)) {
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
    organizationId: string;
    name: string;
    subDepartment: string | null;
    lastChecked: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): StoreArea {
    return {
      id: area.id,
      organizationId: area.organizationId,
      name: area.name,
      subDepartment: area.subDepartment ?? undefined,
      lastChecked: area.lastChecked?.toISOString() ?? undefined,
      createdAt: area.createdAt.toISOString(),
      updatedAt: area.updatedAt.toISOString(),
    };
  }
}
