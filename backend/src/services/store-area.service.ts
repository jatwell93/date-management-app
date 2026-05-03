import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { StoreArea } from '../models/store-area.model';
import { StoreAreaRepository } from '../repositories/store-area.repository';
import { getOrganizationId } from '../utils/auth-bypass';
import { isPrismaNotFound } from '../utils/prisma-error';

export class StoreAreaService {
  private prisma: PrismaClient;
  private storeAreaRepo: StoreAreaRepository;
  private organizationId: string;

  /**
   * Constructor with optional dependency injection
   * @param organizationId - Organization ID for tenant filtering (optional in tests)
   * @param prismaClient - Optional PrismaClient for testing/custom configurations
   */
  constructor(
    organizationId?: string,
    prismaClient?: PrismaClient,
    storeAreaRepo?: StoreAreaRepository,
  ) {
    this.organizationId = getOrganizationId(organizationId);
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.storeAreaRepo = storeAreaRepo ?? new StoreAreaRepository(this.prisma);
  }

  async getAllStoreAreas(): Promise<StoreArea[]> {
    const results = await this.storeAreaRepo.findAll(this.organizationId);
    return results.map(this.mapPrismaToModel);
  }

  async getStoreAreaById(id: number): Promise<StoreArea | null> {
    const result = await this.storeAreaRepo.findById(id, this.organizationId);
    return result ? this.mapPrismaToModel(result) : null;
  }

  async getStoreAreaByName(name: string): Promise<StoreArea[]> {
    const results = await this.storeAreaRepo.findByName(name, this.organizationId);
    return results.map(this.mapPrismaToModel);
  }

  async getStoreAreaByNameAndSubDepartment(
    name: string,
    subDepartment: string | null,
  ): Promise<StoreArea | null> {
    const result = await this.storeAreaRepo.findByNameAndSubDepartment(
      name,
      subDepartment,
      this.organizationId,
    );
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

    const newArea = await this.storeAreaRepo.create(this.organizationId, area);

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
      const updatedArea = await this.storeAreaRepo.update(id, area);

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
      await this.storeAreaRepo.delete(id);
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
