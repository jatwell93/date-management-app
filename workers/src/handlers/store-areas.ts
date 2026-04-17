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

export interface StoreArea {
  id: number;
  name: string;
  description: string | null;
  sub_department: string | null;
  organization_id: string;
  created_at: Date;
  updated_at: Date;
}

export async function getStoreAreas(env: Env, organizationId: string): Promise<StoreArea[]> {
  return withNeonRetry(async () => {
    const sql = neon(getConnectionString(env));
    const results = await sql`
      SELECT id, name, description, sub_department, organization_id,
             created_at, updated_at
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
             created_at, updated_at
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
      RETURNING id, name, description, sub_department, organization_id,
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

function getConnectionString(env: Env): string {
  return env.HYPERDRIVE?.connectionString || env.NEON_CONNECTION_STRING || '';
}
