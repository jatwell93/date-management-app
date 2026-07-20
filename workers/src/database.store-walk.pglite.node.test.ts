import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { Env } from './types/env';
import { createPgliteHarness, createTaggedSql, type PgliteHarness } from './__tests__/pglite-db';

const sqlHolder = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlHolder.current),
}));

import { createWorkersDatabase } from './database';

const ORG = 'org-store-walk';
const OTHER_ORG = 'org-other';
const USER_ID = 1;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Workers store walk tracking (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;
  let departmentId: number;
  let bayAId: number;
  let bayBId: number;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;
  }, 30000);

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await sql`DELETE FROM bay_checks`;
    await sql`DELETE FROM check_cycles`;
    await sql`DELETE FROM inventory_items`;
    await sql`DELETE FROM products`;
    await sql`DELETE FROM store_areas`;
    await sql`DELETE FROM users`;
    await sql`DELETE FROM organizations`;

    await sql`
      INSERT INTO organizations (id, name, slug)
      VALUES (${ORG}, ${'Store Walk Org'}, ${'store-walk-org'}),
             (${OTHER_ORG}, ${'Other Org'}, ${'other-org'})
    `;
    await sql`
      INSERT INTO users (id, organization_id, email, username, role)
      VALUES (${USER_ID}, ${ORG}, ${'checker@example.test'}, ${'Checker One'}, ${'team_member'})
    `;
    const deptRows = await sql`
      INSERT INTO store_areas (organization_id, name, sub_department)
      VALUES (${ORG}, ${'Dairy'}, ${'Dairy'})
      RETURNING id
    `;
    departmentId = Number(deptRows[0].id);
    const bayRows = await sql`
      INSERT INTO store_areas (organization_id, parent_id, name, sub_department, last_checked)
      VALUES
        (${ORG}, ${departmentId}, ${'Dairy Bay 1'}, ${'Dairy'}, ${null}),
        (${ORG}, ${departmentId}, ${'Dairy Bay 2'}, ${'Dairy'}, ${'2026-01-01T00:00:00.000Z'}::timestamptz)
      RETURNING id, name
    `;
    bayAId = Number(bayRows.find((row) => row.name === 'Dairy Bay 1')?.id);
    bayBId = Number(bayRows.find((row) => row.name === 'Dairy Bay 2')?.id);
  });

  it('keeps the Neon store-walk migration safe to run from SQL editors', () => {
    const migrationSql = readFileSync(
      path.resolve(__dirname, '../../backend/prisma/neon-sql/0004_add_store_walk_bay_tracking.sql'),
      'utf8',
    );

    expect(migrationSql).not.toContain('ON COMMIT DROP');
    expect(migrationSql).toContain('DROP TABLE IF EXISTS pg_temp.store_area_backfill_bays;');
  });

  it('runs a cycle lifecycle and permits a new active cycle after completion', async () => {
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);

    const first = await db.createCheckCycle(ORG, { name: 'Morning walk' });
    await expect(db.createCheckCycle(ORG, { name: 'Second walk' })).rejects.toThrow(
      'Active check cycle already exists',
    );

    const completed = await db.completeCheckCycle(ORG, first.id);
    const second = await db.createCheckCycle(ORG, { name: 'Second walk' });
    const cycles = await db.listCheckCycles(ORG);

    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBeTruthy();
    expect(second.status).toBe('active');
    expect(cycles.map((cycle) => cycle.name)).toEqual(['Second walk', 'Morning walk']);
  });

  it('records a bay check against the active cycle and updates the bay lastChecked cache', async () => {
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
    const cycle = await db.createCheckCycle(ORG, { name: 'Morning walk' });

    const check = await db.recordBayCheck(ORG, USER_ID, {
      storeAreaId: bayAId,
      checkedAt: '2026-07-09T09:30:00.000Z',
      itemsAddedCount: 2,
      notes: 'Two new date labels added',
    });
    const areaRows = await sql`
      SELECT last_checked
      FROM store_areas
      WHERE id = ${bayAId} AND organization_id = ${ORG}
    `;

    expect(check).toMatchObject({
      cycleId: cycle.id,
      storeAreaId: bayAId,
      userId: USER_ID,
      itemsAddedCount: 2,
      notes: 'Two new date labels added',
    });
    expect(new Date(String(areaRows[0].last_checked)).toISOString()).toBe(
      '2026-07-09T09:30:00.000Z',
    );
  });

  it('rejects bay checks when there is no active cycle or the target is not a leaf bay', async () => {
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);

    await expect(db.recordBayCheck(ORG, USER_ID, { storeAreaId: bayAId })).rejects.toThrow(
      'Active check cycle is required',
    );

    await db.createCheckCycle(ORG, { name: 'Morning walk' });
    await expect(db.recordBayCheck(ORG, USER_ID, { storeAreaId: departmentId })).rejects.toThrow(
      'Bay check must target a leaf bay',
    );
  });

  it('returns active floor progress grouped by department with current and overdue bay states', async () => {
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
    const cycle = await db.createCheckCycle(ORG, {
      name: 'Morning walk',
      startedAt: '2026-07-09T08:00:00.000Z',
    });

    await db.recordBayCheck(ORG, USER_ID, {
      storeAreaId: bayAId,
      checkedAt: '2026-07-09T09:00:00.000Z',
    });

    const progress = await db.getFloorProgress(ORG);

    expect(progress.activeCycle?.id).toBe(cycle.id);
    expect(progress.summary).toMatchObject({
      totalBays: 2,
      checkedBays: 1,
      uncheckedBays: 1,
      coveragePercent: 50,
    });
    expect(progress.departments).toHaveLength(1);
    expect(progress.departments[0]).toMatchObject({
      department: { id: departmentId, name: 'Dairy' },
      summary: {
        totalBays: 2,
        checkedBays: 1,
        uncheckedBays: 1,
        coveragePercent: 50,
      },
    });
    expect(progress.departments[0].bays.map((bay) => [bay.name, bay.state])).toEqual([
      ['Dairy Bay 1', 'checked'],
      ['Dairy Bay 2', 'overdue'],
    ]);
    expect(progress.departments[0].bays[0]).toMatchObject({
      checkedBy: { id: USER_ID, name: 'Checker One' },
    });
  });
});
