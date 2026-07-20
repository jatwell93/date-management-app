import { Prisma, PrismaClient } from '@prisma/client';
import { injectable, inject } from 'tsyringe';
import {
  BayCheck,
  CheckCycle,
  FloorProgress,
  FloorProgressSummary,
  StoreArea,
} from '../models/store-area.model';
import {
  resolveBayState,
  rollupCoverage,
  type BayCheckForCycle,
  type CoverageSummary,
  type StoreWalkBay,
} from '../../../shared/domain/store-walk-tracking';

type StoreAreaRecord = Prisma.StoreAreaGetPayload<Record<string, never>>;
type DbClient = PrismaClient | Prisma.TransactionClient;

type RawCheckCycle = {
  id: number;
  organizationId: string;
  name: string;
  status: string;
  startedAt: Date | string;
  completedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type RawBayCheck = {
  id: number;
  organizationId: string;
  cycleId: number;
  storeAreaId: number;
  userId: number | null;
  checkedAt: Date | string;
  itemsAddedCount: number;
  notes: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type RawBayRow = {
  id: number;
  name: string;
  parentId: number | null;
  parentName: string | null;
  lastChecked: Date | string | null;
};

type RawCheckRow = {
  storeAreaId: number;
  checkedAt: Date | string;
  userId: number | null;
  checkerName: string | null;
};

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function toIsoStringOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIsoString(value);
}

function toFloorProgressSummary(summary: CoverageSummary): FloorProgressSummary {
  return {
    ...summary,
    uncheckedBays: summary.notCheckedBays + summary.overdueBays,
  };
}

function mapCheckCycle(row: RawCheckCycle): CheckCycle {
  return {
    id: Number(row.id),
    organizationId: row.organizationId,
    name: row.name,
    status: row.status as CheckCycle['status'],
    startedAt: toIsoString(row.startedAt),
    completedAt: toIsoStringOrNull(row.completedAt),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function mapBayCheck(row: RawBayCheck): BayCheck {
  return {
    id: Number(row.id),
    organizationId: row.organizationId,
    cycleId: Number(row.cycleId),
    storeAreaId: Number(row.storeAreaId),
    userId: row.userId === null ? null : Number(row.userId),
    checkedAt: toIsoString(row.checkedAt),
    itemsAddedCount: Number(row.itemsAddedCount),
    notes: row.notes,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

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

  async listCheckCycles(organizationId: string): Promise<CheckCycle[]> {
    const rows = await this.prisma.$queryRaw<RawCheckCycle[]>`
      SELECT id,
             organization_id as "organizationId",
             name,
             status,
             started_at as "startedAt",
             completed_at as "completedAt",
             created_at as "createdAt",
             updated_at as "updatedAt"
      FROM check_cycles
      WHERE organization_id = ${organizationId}
      ORDER BY started_at DESC, id DESC
    `;
    return rows.map(mapCheckCycle);
  }

  async createCheckCycle(
    organizationId: string,
    data: { name: string; startedAt?: string },
  ): Promise<CheckCycle> {
    const activeRows = await this.prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id
      FROM check_cycles
      WHERE organization_id = ${organizationId} AND status = 'active'
      LIMIT 1
    `;
    if (activeRows[0]) {
      throw new Error('Active check cycle already exists');
    }

    const startedAt = data.startedAt ?? new Date().toISOString();
    const rows = await this.prisma.$queryRaw<RawCheckCycle[]>`
      INSERT INTO check_cycles (
        organization_id, name, status, started_at, created_at, updated_at
      )
      VALUES (${organizationId}, ${data.name}, 'active', ${startedAt}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id,
                organization_id as "organizationId",
                name,
                status,
                started_at as "startedAt",
                completed_at as "completedAt",
                created_at as "createdAt",
                updated_at as "updatedAt"
    `;
    return mapCheckCycle(rows[0]);
  }

  async completeCheckCycle(organizationId: string, id: number): Promise<CheckCycle> {
    const completedAt = new Date().toISOString();
    const rows = await this.prisma.$queryRaw<RawCheckCycle[]>`
      UPDATE check_cycles
      SET status = 'completed',
          completed_at = ${completedAt},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
        AND organization_id = ${organizationId}
        AND status = 'active'
      RETURNING id,
                organization_id as "organizationId",
                name,
                status,
                started_at as "startedAt",
                completed_at as "completedAt",
                created_at as "createdAt",
                updated_at as "updatedAt"
    `;
    if (!rows[0]) {
      throw new Error('Active check cycle not found');
    }
    return mapCheckCycle(rows[0]);
  }

  async recordBayCheck(
    organizationId: string,
    userId: number,
    data: {
      storeAreaId: number;
      checkedAt?: string;
      itemsAddedCount?: number;
      notes?: string | null;
    },
  ): Promise<BayCheck> {
    return this.prisma.$transaction(async (tx) => {
      const activeRows = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT id
        FROM check_cycles
        WHERE organization_id = ${organizationId} AND status = 'active'
        ORDER BY started_at DESC, id DESC
        LIMIT 1
      `;
      const activeCycleId = activeRows[0]?.id;
      if (!activeCycleId) {
        throw new Error('Active check cycle is required');
      }

      const bayRows = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT id
        FROM store_areas
        WHERE id = ${data.storeAreaId}
          AND organization_id = ${organizationId}
          AND parent_id IS NOT NULL
        LIMIT 1
      `;
      if (!bayRows[0]) {
        throw new Error('Bay check must target a leaf bay');
      }

      const checkedAt = data.checkedAt ?? new Date().toISOString();
      const rows = await tx.$queryRaw<RawBayCheck[]>`
        INSERT INTO bay_checks (
          organization_id,
          cycle_id,
          store_area_id,
          user_id,
          checked_at,
          items_added_count,
          notes,
          created_at,
          updated_at
        )
        VALUES (
          ${organizationId},
          ${Number(activeCycleId)},
          ${data.storeAreaId},
          ${userId},
          ${checkedAt},
          ${data.itemsAddedCount ?? 0},
          ${data.notes ?? null},
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        RETURNING id,
                  organization_id as "organizationId",
                  cycle_id as "cycleId",
                  store_area_id as "storeAreaId",
                  user_id as "userId",
                  checked_at as "checkedAt",
                  items_added_count as "itemsAddedCount",
                  notes,
                  created_at as "createdAt",
                  updated_at as "updatedAt"
      `;

      await tx.$executeRaw`
        UPDATE store_areas
        SET last_checked = ${checkedAt},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${data.storeAreaId}
          AND organization_id = ${organizationId}
      `;

      return mapBayCheck(rows[0]);
    });
  }

  async getFloorProgress(organizationId: string): Promise<FloorProgress> {
    const cycleRows = await this.prisma.$queryRaw<RawCheckCycle[]>`
      SELECT id,
             organization_id as "organizationId",
             name,
             status,
             started_at as "startedAt",
             completed_at as "completedAt",
             created_at as "createdAt",
             updated_at as "updatedAt"
      FROM check_cycles
      WHERE organization_id = ${organizationId} AND status = 'active'
      ORDER BY started_at DESC, id DESC
      LIMIT 1
    `;
    const activeCycle = cycleRows[0] ? mapCheckCycle(cycleRows[0]) : null;

    const bayRows = await this.prisma.$queryRaw<RawBayRow[]>`
      SELECT bay.id,
             bay.name,
             bay.parent_id as "parentId",
             department.name as "parentName",
             bay.last_checked as "lastChecked"
      FROM store_areas bay
      LEFT JOIN store_areas department ON bay.parent_id = department.id
      WHERE bay.organization_id = ${organizationId}
        AND bay.parent_id IS NOT NULL
      ORDER BY department.name ASC, bay.name ASC, bay.id ASC
    `;
    const bays = bayRows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      parentId: row.parentId === null ? null : Number(row.parentId),
      parentName: row.parentName,
      lastChecked: toIsoStringOrNull(row.lastChecked),
    })) satisfies StoreWalkBay[];

    if (!activeCycle) {
      return {
        activeCycle: null,
        summary: toFloorProgressSummary({
          totalBays: bays.length,
          checkedBays: 0,
          notCheckedBays: bays.length,
          overdueBays: 0,
          coveragePercent: 0,
        }),
        departments: [],
      };
    }

    const checkRows = await this.prisma.$queryRaw<RawCheckRow[]>`
      SELECT bc.store_area_id as "storeAreaId",
             bc.checked_at as "checkedAt",
             bc.user_id as "userId",
             users.role as "checkerName"
      FROM bay_checks bc
      LEFT JOIN users ON bc.user_id = users.id
      WHERE bc.organization_id = ${organizationId}
        AND bc.cycle_id = ${activeCycle.id}
      ORDER BY bc.checked_at DESC, bc.id DESC
    `;
    const checksForCycle = checkRows.map((row) => ({
      storeAreaId: Number(row.storeAreaId),
      checkedAt: toIsoString(row.checkedAt),
      userId: row.userId === null ? null : Number(row.userId),
      checkerName: row.checkerName,
    })) satisfies BayCheckForCycle[];
    const rollup = rollupCoverage(bays, checksForCycle, activeCycle.startedAt);

    return {
      activeCycle,
      summary: toFloorProgressSummary(rollup.store),
      departments: rollup.departments.map((department) => ({
        department: { id: department.departmentId, name: department.departmentName },
        summary: toFloorProgressSummary(department),
        bays: bays
          .filter((bay) => bay.parentId === department.departmentId)
          .map((bay) => {
            const state = resolveBayState(bay, checksForCycle, activeCycle.startedAt);
            return {
              id: bay.id,
              name: bay.name,
              parentId: bay.parentId,
              state: state.state,
              checkedAt: state.checkedAt?.toISOString() ?? null,
              checkedBy:
                state.userId === null ? null : { id: state.userId, name: state.checkerName },
            };
          }),
      })),
    };
  }
}
