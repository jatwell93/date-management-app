export type CheckCycleStatus = 'active' | 'completed';
export type BayCheckState = 'checked' | 'not_checked' | 'overdue';

export interface StoreWalkBay {
  id: number;
  name: string;
  parentId: number | null;
  parentName: string | null;
  lastChecked: Date | string | null;
}

export interface BayCheckForCycle {
  storeAreaId: number;
  checkedAt: Date | string;
  userId?: number | null;
  checkerName?: string | null;
}

export interface ResolvedBayState {
  state: BayCheckState;
  checkedAt: Date | null;
  userId: number | null;
  checkerName: string | null;
}

export interface CoverageSummary {
  totalBays: number;
  checkedBays: number;
  notCheckedBays: number;
  overdueBays: number;
  coveragePercent: number;
}

export interface DepartmentCoverageSummary extends CoverageSummary {
  departmentId: number | null;
  departmentName: string;
}

export interface CoverageRollup {
  store: CoverageSummary;
  departments: DepartmentCoverageSummary[];
}

function toDate(value: Date | string | null): Date | null {
  if (value === null) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function latestCheckForBay(
  bayId: number,
  checksForCycle: readonly BayCheckForCycle[],
): BayCheckForCycle | null {
  return (
    [...checksForCycle]
      .filter((check) => check.storeAreaId === bayId)
      .sort((left, right) => {
        const leftCheckedAt = toDate(left.checkedAt)?.getTime() ?? 0;
        const rightCheckedAt = toDate(right.checkedAt)?.getTime() ?? 0;
        return rightCheckedAt - leftCheckedAt;
      })[0] ?? null
  );
}

function emptySummary(): CoverageSummary {
  return {
    totalBays: 0,
    checkedBays: 0,
    notCheckedBays: 0,
    overdueBays: 0,
    coveragePercent: 0,
  };
}

function incrementSummary(summary: CoverageSummary, state: BayCheckState): void {
  summary.totalBays += 1;

  if (state === 'checked') {
    summary.checkedBays += 1;
  } else if (state === 'overdue') {
    summary.overdueBays += 1;
  } else {
    summary.notCheckedBays += 1;
  }

  summary.coveragePercent =
    summary.totalBays === 0 ? 0 : Math.round((summary.checkedBays / summary.totalBays) * 100);
}

export function resolveBayState(
  bay: StoreWalkBay,
  checksForCycle: readonly BayCheckForCycle[],
  cycleStartedAt: Date | string,
): ResolvedBayState {
  const activeCycleCheck = latestCheckForBay(bay.id, checksForCycle);
  if (activeCycleCheck !== null) {
    return {
      state: 'checked',
      checkedAt: toDate(activeCycleCheck.checkedAt),
      userId: activeCycleCheck.userId ?? null,
      checkerName: activeCycleCheck.checkerName ?? null,
    };
  }

  const lastChecked = toDate(bay.lastChecked);
  const startedAt = toDate(cycleStartedAt);
  if (lastChecked !== null && startedAt !== null && lastChecked < startedAt) {
    return {
      state: 'overdue',
      checkedAt: lastChecked,
      userId: null,
      checkerName: null,
    };
  }

  return {
    state: 'not_checked',
    checkedAt: null,
    userId: null,
    checkerName: null,
  };
}

export function rollupCoverage(
  bays: readonly StoreWalkBay[],
  checksForCycle: readonly BayCheckForCycle[],
  cycleStartedAt: Date | string,
): CoverageRollup {
  const store = emptySummary();
  const departmentSummaries = new Map<number | null, DepartmentCoverageSummary>();

  for (const bay of bays) {
    const resolved = resolveBayState(bay, checksForCycle, cycleStartedAt);
    incrementSummary(store, resolved.state);

    const departmentId = bay.parentId;
    const existing = departmentSummaries.get(departmentId);
    const department =
      existing ??
      ({
        ...emptySummary(),
        departmentId,
        departmentName: bay.parentName ?? 'Unassigned',
      } satisfies DepartmentCoverageSummary);

    incrementSummary(department, resolved.state);
    departmentSummaries.set(departmentId, department);
  }

  return {
    store,
    departments: Array.from(departmentSummaries.values()),
  };
}
