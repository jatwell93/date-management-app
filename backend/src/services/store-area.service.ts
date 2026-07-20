import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import {
  BayCheck,
  CheckCycle,
  FloorProgress,
  FloorProgressBay,
  StoreArea,
} from '../models/store-area.model';
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

  async listCheckCycles(): Promise<CheckCycle[]> {
    const cycles = await this.storeAreaRepo.listCheckCycles(this.organizationId);
    return cycles.map(this.mapCheckCycle);
  }

  async createCheckCycle(data: { name: string; startedAt?: string }): Promise<CheckCycle> {
    const cycle = await this.storeAreaRepo.createCheckCycle(this.organizationId, {
      name: data.name,
      startedAt: data.startedAt,
    });
    return this.mapCheckCycle(cycle);
  }

  async completeCheckCycle(id: number): Promise<CheckCycle> {
    const cycle = await this.storeAreaRepo.completeCheckCycle(this.organizationId, id);
    return this.mapCheckCycle(cycle);
  }

  async recordBayCheck(
    userId: number,
    data: {
      storeAreaId: number;
      checkedAt?: string;
      itemsAddedCount?: number;
      notes?: string | null;
    },
  ): Promise<BayCheck> {
    const check = await this.storeAreaRepo.recordBayCheck(this.organizationId, userId, data);
    return this.mapBayCheck(check);
  }

  async getFloorProgress(): Promise<FloorProgress> {
    const progress = await this.storeAreaRepo.getFloorProgress(this.organizationId);
    return {
      activeCycle: progress.activeCycle ? this.mapCheckCycle(progress.activeCycle) : null,
      summary: progress.summary,
      departments: progress.departments.map((department) => ({
        department: department.department,
        summary: department.summary,
        bays: department.bays.map(this.mapFloorProgressBay),
      })),
    };
  }

  /**
   * Map Prisma model to legacy StoreArea interface
   */
  private mapPrismaToModel(area: {
    id: number;
    organizationId: string;
    name: string;
    subDepartment: string | null;
    parentId?: number | null;
    lastChecked: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): StoreArea {
    return {
      id: area.id,
      organizationId: area.organizationId,
      name: area.name,
      subDepartment: area.subDepartment ?? undefined,
      parentId: area.parentId ?? undefined,
      lastChecked: area.lastChecked?.toISOString() ?? undefined,
      createdAt: area.createdAt.toISOString(),
      updatedAt: area.updatedAt.toISOString(),
    };
  }

  private mapCheckCycle(cycle: {
    id: number;
    organizationId: string;
    name: string;
    status: CheckCycle['status'];
    startedAt: string | Date;
    completedAt: string | Date | null;
    createdAt: string | Date;
    updatedAt: string | Date;
  }): CheckCycle {
    return {
      id: cycle.id,
      organizationId: cycle.organizationId,
      name: cycle.name,
      status: cycle.status,
      startedAt: this.toIsoString(cycle.startedAt),
      completedAt: cycle.completedAt === null ? null : this.toIsoString(cycle.completedAt),
      createdAt: this.toIsoString(cycle.createdAt),
      updatedAt: this.toIsoString(cycle.updatedAt),
    };
  }

  private mapBayCheck(check: {
    id: number;
    organizationId: string;
    cycleId: number;
    storeAreaId: number;
    userId: number | null;
    checkedAt: string | Date;
    itemsAddedCount: number;
    notes: string | null;
    createdAt: string | Date;
    updatedAt: string | Date;
  }): BayCheck {
    return {
      id: check.id,
      organizationId: check.organizationId,
      cycleId: check.cycleId,
      storeAreaId: check.storeAreaId,
      userId: check.userId,
      checkedAt: this.toIsoString(check.checkedAt),
      itemsAddedCount: check.itemsAddedCount,
      notes: check.notes,
      createdAt: this.toIsoString(check.createdAt),
      updatedAt: this.toIsoString(check.updatedAt),
    };
  }

  private mapFloorProgressBay = (bay: FloorProgressBay): FloorProgressBay => ({
    ...bay,
    checkedAt: bay.checkedAt === null ? null : this.toIsoString(bay.checkedAt),
  });

  private toIsoString(value: string | Date): string {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }
}
