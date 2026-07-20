/**
 * Store Areas Handler - Multi-Tenant Safe
 *
 * All queries filter by organizationId to prevent SQL injection
 * and ensure multi-tenant data isolation.
 *
 * All database operations include automatic retry logic for transient failures.
 */

import { neon } from '@neondatabase/serverless';
import type { Env } from '../types/env';
import { withNeonRetry } from '../utils/db-retry';
import { getConnectionString } from '../utils/db-connection';
import {
  resolveBayState,
  rollupCoverage,
  type BayCheckForCycle,
  type CoverageSummary,
  type StoreWalkBay,
} from '../../../shared/domain/store-walk-tracking';
import type { BayCheck, CheckCycle, FloorProgress, FloorProgressSummary } from '../database';

export interface StoreArea {
  id: number;
  name: string;
  description: string | null;
  sub_department: string | null;
  parent_id: number | null;
  last_checked: Date | string | null;
  organization_id: string;
  created_at: Date;
  updated_at: Date;
}

function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toIsoStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toFloorProgressSummary(summary: CoverageSummary): FloorProgressSummary {
  return {
    ...summary,
    uncheckedBays: summary.notCheckedBays + summary.overdueBays,
  };
}

function toCheckCycle(row: Record<string, unknown>): CheckCycle {
  return {
    id: Number(row.id),
    organizationId: String(row.organizationId),
    name: String(row.name),
    status: row.status as CheckCycle['status'],
    startedAt: toIsoStringOrNull(row.startedAt) ?? '',
    completedAt: toIsoStringOrNull(row.completedAt),
    createdAt: toIsoStringOrNull(row.createdAt) ?? '',
    updatedAt: toIsoStringOrNull(row.updatedAt) ?? '',
  };
}

function toBayCheck(row: Record<string, unknown>): BayCheck {
  return {
    id: Number(row.id),
    organizationId: String(row.organizationId),
    cycleId: Number(row.cycleId),
    storeAreaId: Number(row.storeAreaId),
    userId: toNumberOrNull(row.userId),
    checkedAt: toIsoStringOrNull(row.checkedAt) ?? '',
    itemsAddedCount: Number(row.itemsAddedCount),
    notes: row.notes === null || row.notes === undefined ? null : String(row.notes),
    createdAt: toIsoStringOrNull(row.createdAt) ?? '',
    updatedAt: toIsoStringOrNull(row.updatedAt) ?? '',
  };
}

export async function getStoreAreas(env: Env, organizationId: string): Promise<StoreArea[]> {
  return withNeonRetry(async () => {
    const sql = neon(getConnectionString(env));
    const results = await sql`
      SELECT id, name, description, sub_department, organization_id,
             parent_id, last_checked, created_at, updated_at
      FROM store_areas
      WHERE organization_id = ${organizationId}
      ORDER BY name ASC
    `;
    return results as StoreArea[];
  });
}

export async function getStoreAreaById(
  env: Env,
  organizationId: string,
  areaId: number,
): Promise<StoreArea | null> {
  return withNeonRetry(async () => {
    const sql = neon(getConnectionString(env));
    const results = await sql`
      SELECT id, name, description, sub_department, organization_id,
             parent_id, last_checked, created_at, updated_at
      FROM store_areas
      WHERE id = ${areaId} AND organization_id = ${organizationId}
    `;
    return (results[0] as StoreArea) || null;
  });
}

export async function countStoreAreas(env: Env, organizationId: string): Promise<number> {
  return withNeonRetry(async () => {
    const sql = neon(getConnectionString(env));
    const results = await sql`
      SELECT COUNT(*) as count FROM store_areas
      WHERE organization_id = ${organizationId}
    `;
    return ((results[0] as any).count as number) ?? 0;
  });
}

export async function createStoreArea(
  env: Env,
  organizationId: string,
  areaData: {
    name: string;
    description?: string;
    subDepartment?: string;
  },
): Promise<StoreArea> {
  return withNeonRetry(async () => {
    const sql = neon(getConnectionString(env));
    const results = (await sql`
      INSERT INTO store_areas (
        name, description, sub_department, organization_id, created_at, updated_at
      ) VALUES (
        ${areaData.name},
        ${areaData.description || null},
        ${areaData.subDepartment || null},
        ${organizationId},
        NOW(),
        NOW()
      )
      RETURNING id, name, description, sub_department, parent_id, last_checked, organization_id,
                created_at, updated_at
    `) as StoreArea[];

    if (!results[0]) throw new Error('Failed to create store area');
    return results[0];
  });
}

export async function deleteStoreArea(
  env: Env,
  organizationId: string,
  areaId: number,
): Promise<boolean> {
  return withNeonRetry(async () => {
    const existing = await getStoreAreaById(env, organizationId, areaId);
    if (!existing) return false;

    const sql = neon(getConnectionString(env));
    const results = await sql`
      DELETE FROM store_areas
      WHERE id = ${areaId} AND organization_id = ${organizationId}
      RETURNING id
    `;
    return results.length > 0;
  });
}

export async function listCheckCycles(env: Env, organizationId: string): Promise<CheckCycle[]> {
  return withNeonRetry(async () => {
    const sql = neon(getConnectionString(env));
    const rows = await sql`
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
    return rows.map((row) => toCheckCycle(row as Record<string, unknown>));
  });
}

export async function createCheckCycle(
  env: Env,
  organizationId: string,
  data: { name: string; startedAt?: string },
): Promise<CheckCycle> {
  return withNeonRetry(async () => {
    const sql = neon(getConnectionString(env));
    const activeRows = await sql`
      SELECT id FROM check_cycles
      WHERE organization_id = ${organizationId} AND status = 'active'
      LIMIT 1
    `;
    if (activeRows[0]) throw new Error('Active check cycle already exists');

    const rows = await sql`
      INSERT INTO check_cycles (organization_id, name, status, started_at, created_at, updated_at)
      VALUES (
        ${organizationId},
        ${data.name},
        'active',
        COALESCE(${data.startedAt ?? null}::timestamptz, NOW()),
        NOW(),
        NOW()
      )
      RETURNING id,
                organization_id as "organizationId",
                name,
                status,
                started_at as "startedAt",
                completed_at as "completedAt",
                created_at as "createdAt",
                updated_at as "updatedAt"
    `;
    return toCheckCycle(rows[0] as Record<string, unknown>);
  });
}

export async function completeCheckCycle(
  env: Env,
  organizationId: string,
  id: number,
): Promise<CheckCycle> {
  return withNeonRetry(async () => {
    const sql = neon(getConnectionString(env));
    const rows = await sql`
      UPDATE check_cycles
      SET status = 'completed',
          completed_at = NOW(),
          updated_at = NOW()
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
    if (!rows[0]) throw new Error('Active check cycle not found');
    return toCheckCycle(rows[0] as Record<string, unknown>);
  });
}

export async function recordBayCheck(
  env: Env,
  organizationId: string,
  userId: number,
  data: {
    storeAreaId: number;
    checkedAt?: string;
    itemsAddedCount?: number;
    notes?: string | null;
  },
): Promise<BayCheck> {
  return withNeonRetry(async () => {
    const sql = neon(getConnectionString(env));
    const activeRows = await sql`
      SELECT id FROM check_cycles
      WHERE organization_id = ${organizationId} AND status = 'active'
      ORDER BY started_at DESC, id DESC
      LIMIT 1
    `;
    const activeCycleId = activeRows[0]?.id;
    if (!activeCycleId) throw new Error('Active check cycle is required');

    const bayRows = await sql`
      SELECT id FROM store_areas
      WHERE id = ${data.storeAreaId}
        AND organization_id = ${organizationId}
        AND parent_id IS NOT NULL
      LIMIT 1
    `;
    if (!bayRows[0]) throw new Error('Bay check must target a leaf bay');

    const rows = await sql`
      WITH inserted AS (
        INSERT INTO bay_checks (
          organization_id, cycle_id, store_area_id, user_id, checked_at,
          items_added_count, notes, created_at, updated_at
        )
        VALUES (
          ${organizationId},
          ${Number(activeCycleId)},
          ${data.storeAreaId},
          ${userId},
          COALESCE(${data.checkedAt ?? null}::timestamptz, NOW()),
          ${data.itemsAddedCount ?? 0},
          ${data.notes ?? null},
          NOW(),
          NOW()
        )
        RETURNING id, organization_id, cycle_id, store_area_id, user_id, checked_at,
                  items_added_count, notes, created_at, updated_at
      ), updated_area AS (
        UPDATE store_areas
        SET last_checked = (SELECT checked_at FROM inserted),
            updated_at = NOW()
        WHERE id = ${data.storeAreaId}
          AND organization_id = ${organizationId}
      )
      SELECT id,
             organization_id as "organizationId",
             cycle_id as "cycleId",
             store_area_id as "storeAreaId",
             user_id as "userId",
             checked_at as "checkedAt",
             items_added_count as "itemsAddedCount",
             notes,
             created_at as "createdAt",
             updated_at as "updatedAt"
      FROM inserted
    `;
    return toBayCheck(rows[0] as Record<string, unknown>);
  });
}

export async function getFloorProgress(env: Env, organizationId: string): Promise<FloorProgress> {
  return withNeonRetry(async () => {
    const sql = neon(getConnectionString(env));
    const cycleRows = await sql`
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
    const activeCycle = cycleRows[0] ? toCheckCycle(cycleRows[0] as Record<string, unknown>) : null;

    const bayRows = await sql`
      SELECT bay.id,
             bay.name,
             bay.parent_id as "parentId",
             department.name as "parentName",
             bay.last_checked as "lastChecked"
      FROM store_areas bay
      LEFT JOIN store_areas department ON bay.parent_id = department.id
      WHERE bay.organization_id = ${organizationId}
        AND bay.parent_id IS NOT NULL
      ORDER BY department.name ASC NULLS LAST, bay.name ASC, bay.id ASC
    `;
    const bays = bayRows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      parentId: toNumberOrNull(row.parentId),
      parentName: row.parentName == null ? null : String(row.parentName),
      lastChecked: row.lastChecked == null ? null : String(row.lastChecked),
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

    const checkRows = await sql`
      SELECT bc.store_area_id as "storeAreaId",
             bc.checked_at as "checkedAt",
             bc.user_id as "userId",
             users.username as "checkerName"
      FROM bay_checks bc
      LEFT JOIN users ON bc.user_id = users.id
      WHERE bc.organization_id = ${organizationId}
        AND bc.cycle_id = ${activeCycle.id}
      ORDER BY bc.checked_at DESC, bc.id DESC
    `;
    const checksForCycle = checkRows.map((row) => ({
      storeAreaId: Number(row.storeAreaId),
      checkedAt: String(row.checkedAt),
      userId: toNumberOrNull(row.userId),
      checkerName: row.checkerName == null ? null : String(row.checkerName),
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
  });
}
