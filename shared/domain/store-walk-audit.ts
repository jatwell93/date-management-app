// Shared store-walk audit rollup. Both backends (SQLite dev repo and the
// Cloudflare Workers Neon path) fetch the same three result sets — cycle rows,
// per-user aggregate rows, and the total bay count — but the SQL dialects and
// user-name sources differ, so the queries stay in each backend. This module
// owns the *rollup*: turning those normalized rows into the audit cycles the
// frontend renders, plus the derived flags. Keeping it here means the two
// backends can never drift on the maths or the flag wording again (they used
// to: the Workers copy had dropped "consecutive" from the zero-findings flag).

export interface StoreWalkAuditUser {
  userId: number;
  userName: string;
  baysChecked: number;
  coveragePercent: number;
  baysPerHour: number;
}

export interface StoreWalkAuditFlag {
  type: 'implausible_pace' | 'all_zero_findings';
  userName: string;
  message: string;
}

export interface StoreWalkAuditCycle {
  cycleId: number;
  cycleName: string;
  status: string;
  completionMinutes: number | null;
  users: StoreWalkAuditUser[];
  flags: StoreWalkAuditFlag[];
}

/**
 * One row per cycle, already reduced to the fields the rollup needs. Each
 * backend computes `completionMinutes` in its own dialect (JS date maths for
 * SQLite, `EXTRACT(EPOCH ...)` for Postgres) so this stays a plain number.
 */
export interface StoreWalkAuditCycleRow {
  cycleId: number;
  cycleName: string;
  status: string;
  completionMinutes: number | null;
}

/**
 * One row per (cycle, user) aggregate. `elapsedHours` is the floor-clamped
 * span between the user's first and last bay check for that cycle — computed
 * by each backend before it reaches here, matching the original per-backend
 * formula (`GREATEST(..., 1/60)`).
 */
export interface StoreWalkAuditUserRow {
  cycleId: number;
  userId: number;
  userName: string;
  baysChecked: number;
  elapsedHours: number;
  zeroFindingChecks: number;
}

// Bays checked per hour above this pace is flagged for review.
const IMPLAUSIBLE_PACE_THRESHOLD = 10;
// This many zero-finding bay checks by one user is flagged as suspicious.
const ZERO_FINDINGS_THRESHOLD = 6;

export function formatStoreWalkAuditNumber(value: number): string {
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1 }).format(value);
}

/**
 * Roll normalized cycle/user rows up into the audit report. Cycle order is
 * preserved from `cycleRows`; users are matched to their cycle by `cycleId`,
 * keeping the query's ordering. Coverage is relative to `totalBays` (the count
 * of leaf bays for the organization), and `baysPerHour` divides by the
 * pre-clamped `elapsedHours`, so a lone check never divides by zero.
 */
export function buildStoreWalkAuditReport(
  cycleRows: readonly StoreWalkAuditCycleRow[],
  userRows: readonly StoreWalkAuditUserRow[],
  totalBays: number,
): StoreWalkAuditCycle[] {
  return cycleRows.map((cycle) => {
    const sourceRows = userRows.filter((row) => Number(row.cycleId) === Number(cycle.cycleId));

    const users: StoreWalkAuditUser[] = sourceRows.map((row) => {
      const baysChecked = Number(row.baysChecked);
      const elapsedHours = Number(row.elapsedHours);
      return {
        userId: Number(row.userId),
        userName: row.userName,
        baysChecked,
        coveragePercent: totalBays === 0 ? 0 : Math.round((baysChecked / totalBays) * 100),
        baysPerHour: Number((baysChecked / elapsedHours).toFixed(1)),
      };
    });

    const flags = users.flatMap((user) => {
      const source = sourceRows.find((row) => Number(row.userId) === user.userId);
      const userFlags: StoreWalkAuditFlag[] = [];
      if (user.baysPerHour > IMPLAUSIBLE_PACE_THRESHOLD) {
        userFlags.push({
          type: 'implausible_pace',
          userName: user.userName,
          message: `${formatStoreWalkAuditNumber(user.baysPerHour)} bays/hour is faster than the review threshold.`,
        });
      }
      if (source && Number(source.zeroFindingChecks) >= ZERO_FINDINGS_THRESHOLD) {
        userFlags.push({
          type: 'all_zero_findings',
          userName: user.userName,
          message: `${formatStoreWalkAuditNumber(Number(source.zeroFindingChecks))} consecutive bay checks recorded zero items added.`,
        });
      }
      return userFlags;
    });

    return {
      cycleId: Number(cycle.cycleId),
      cycleName: cycle.cycleName,
      status: cycle.status,
      completionMinutes: cycle.completionMinutes === null ? null : Number(cycle.completionMinutes),
      users,
      flags,
    };
  });
}
