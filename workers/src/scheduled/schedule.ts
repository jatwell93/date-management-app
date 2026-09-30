/**
 * The schedule table for the Worker's Cron Trigger jobs.
 *
 * One cron expression (`0 * * * *` in `wrangler.toml` `[env.production.triggers]`)
 * wakes the Worker hourly; which jobs run when is decided here in code rather
 * than in more cron expressions, so a missed tick's catch-up logic (see
 * `isJobDue`) and a job's lease length are testable TypeScript instead of
 * dashboard state.
 *
 * Job names are the `scheduled_job_runs.job_name` primary key (migration 0016)
 * — never rename an entry without a story for the old row.
 */
import type { Database } from '../database';
import type { Env } from '../types/env';
import { markdownRecalculationJob } from './jobs/markdown-recalculation';
import { stripeReconciliationJob } from './jobs/stripe-reconciliation';
import { creditClaimPhotoPurgeJob } from './jobs/credit-claim-photo-purge';
import { webhookMonitoringJob } from './jobs/webhook-monitoring';

export type SqlClient = Database['sql'];

/** `hourly` runs every tick; `daily` runs once its UTC hour's slot is reached. */
export type JobCadence = { kind: 'hourly' } | { kind: 'daily'; hourUtc: number };

export interface JobContext {
  env: Env;
  sql: SqlClient;
  /** The tick's scheduled time — `new Date(controller.scheduledTime)`, never Date.now(). */
  asOf: Date;
}

/**
 * `failed: true` records the run as failed (retried on the next tick) without
 * throwing; it is for partial failure — e.g. per-row errors a job absorbed —
 * where throwing would say less than the summary does.
 */
export interface JobResult {
  summary: Record<string, unknown>;
  failed?: boolean;
}

export interface ScheduledJob {
  name: string;
  cadence: JobCadence;
  /**
   * How long a claimed tick may hold the job before another tick may take it
   * over. Longer than the job's expected duration, short enough that a crashed
   * tick doesn't strand the job past its next slot.
   */
  leaseSeconds: number;
  run(ctx: JobContext): Promise<JobResult>;
}

/**
 * Daily `hourUtc` values are spread so the four jobs never share an hour's
 * work. Everything runs inside the single hourly tick; the hour is when a job
 * becomes *due*, not when it is scheduled — a delayed tick still catches up.
 */
export const SCHEDULED_JOBS: readonly ScheduledJob[] = [
  markdownRecalculationJob,
  stripeReconciliationJob,
  creditClaimPhotoPurgeJob,
  webhookMonitoringJob,
];

/**
 * Whether `job` owes a run at `asOf`, given the run state row (if any).
 *
 * - hourly: always due — cadence is "every tick".
 * - daily: due once `asOf` passes today's slot (`hourUtc` UTC) unless
 *   `lastSucceededAt` already covers that slot. Comparing against the *slot*,
 *   not "24 hours ago", gives the two properties a cron cannot express on its
 *   own: a tick delayed past the slot still catches up, and a failed run
 *   (which never writes `last_succeeded_at`) is retried on the next tick.
 */
export function isJobDue(
  job: ScheduledJob,
  state: { lastSucceededAt: Date | null } | undefined,
  asOf: Date,
): boolean {
  if (job.cadence.kind === 'hourly') {
    return true;
  }
  const slot = Date.UTC(
    asOf.getUTCFullYear(),
    asOf.getUTCMonth(),
    asOf.getUTCDate(),
    job.cadence.hourUtc,
  );
  if (asOf.getTime() < slot) {
    return false;
  }
  const lastSucceededAt = state?.lastSucceededAt ?? null;
  if (lastSucceededAt === null) {
    return true;
  }
  return lastSucceededAt.getTime() < slot;
}
