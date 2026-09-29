/**
 * Dispatcher for the Worker's single hourly Cron Trigger.
 *
 * `wrangler.toml` registers `0 * * * *` on production only; this module decides,
 * per job in `SCHEDULED_JOBS`, whether that job is due, claims it with a row
 * lease, runs it, and records the outcome. The lease replaces the advisory
 * locks Express's `JobLockRepository` used — impossible over the Neon HTTP
 * driver, which has no session (audit Finding 14; see migration 0016).
 *
 * Ordering is sequential on purpose: jobs share one database pool and the tick
 * is hourly, so running them one at a time is cheap and keeps `scheduled_job_runs`
 * an honest record of what overlapped nothing.
 *
 * Kill switch: set `SCHEDULED_JOBS_DISABLED="true"` as a Worker secret (e.g.
 * via the Cloudflare dashboard or `wrangler secret put`) — it takes effect on
 * the next tick without shipping new code; unset it to re-enable. Deliberately
 * absent from `wrangler.toml` vars so the default (enabled) is not encoded
 * twice.
 */
import { neon } from '@neondatabase/serverless';
import * as Sentry from '@sentry/cloudflare';
import type { Env } from '../types/env';
import { getConnectionString } from '../utils/db-connection';
import {
  isJobDue,
  SCHEDULED_JOBS,
  type JobResult,
  type ScheduledJob,
  type SqlClient,
} from './schedule';

type CaptureException = (
  error: unknown,
  context?: { tags?: Record<string, string>; extra?: Record<string, unknown> },
) => void;

export interface TickDeps {
  sql?: SqlClient;
  jobs?: readonly ScheduledJob[];
  captureException?: CaptureException;
}

export type JobOutcome = 'succeeded' | 'failed' | 'skipped-lease-held' | 'not-due';

export interface TickReportEntry {
  job: string;
  outcome: JobOutcome;
  durationMs: number;
  summary?: Record<string, unknown>;
}

export interface TickReport {
  asOf: string;
  disabled?: boolean;
  jobs: TickReportEntry[];
}

interface JobRunStateRow {
  job_name: string;
  lastSucceededAt: string | Date | null;
}

/**
 * Claim a job's row for this tick. Single statement: the INSERT seeds the row
 * on first ever run; the UPDATE path only fires while the previous lease is
 * absent or expired (`lease_expires_at <= asOf`), so a still-running tick keeps
 * its lease. Returns true when this tick holds the job.
 */
export async function acquireJobLease(
  sql: SqlClient,
  job: ScheduledJob,
  token: string,
  asOfIso: string,
): Promise<boolean> {
  const rows = (await sql`
    INSERT INTO scheduled_job_runs
      (job_name, lease_token, lease_expires_at, last_started_at, last_status, updated_at)
    VALUES (
      ${job.name}, ${token},
      ${asOfIso}::timestamp + make_interval(secs => ${job.leaseSeconds}),
      ${asOfIso}::timestamp, 'running', NOW()
    )
    ON CONFLICT (job_name) DO UPDATE SET
      lease_token = EXCLUDED.lease_token,
      lease_expires_at = EXCLUDED.lease_expires_at,
      last_started_at = EXCLUDED.last_started_at,
      last_status = 'running',
      updated_at = NOW()
    WHERE scheduled_job_runs.lease_expires_at IS NULL
       OR scheduled_job_runs.lease_expires_at <= ${asOfIso}::timestamp
    RETURNING job_name
  `) as unknown[];
  return rows.length > 0;
}

/**
 * Record the outcome and drop the lease. Scoping on `lease_token` makes a stale
 * release a no-op: if the lease expired and another tick re-claimed the job,
 * this tick must not clobber that row's state.
 *
 * `last_succeeded_at` stores `asOf` — the tick's *scheduled* instant — so
 * `isJobDue` compares like with like (a slot timestamp, not wall-clock time).
 */
export async function releaseJobLease(
  sql: SqlClient,
  jobName: string,
  token: string,
  asOfIso: string,
  succeeded: boolean,
  errorText: string | null,
): Promise<void> {
  // Bound the stored error — a pathological stack must not grow the row.
  const boundedError = errorText === null ? null : errorText.slice(0, 2000);
  await sql`
    UPDATE scheduled_job_runs
    SET lease_token = NULL,
        lease_expires_at = NULL,
        last_finished_at = NOW(),
        last_status = ${succeeded ? 'succeeded' : 'failed'},
        last_succeeded_at = CASE WHEN ${succeeded}
                                 THEN ${asOfIso}::timestamp
                                 ELSE last_succeeded_at END,
        last_error = ${boundedError},
        updated_at = NOW()
    WHERE job_name = ${jobName} AND lease_token = ${token}
  `;
}

/** Structured per-job log line — greppable, and it feeds the run-state story. */
function logJob(
  job: string,
  outcome: JobOutcome,
  durationMs: number,
  summary?: Record<string, unknown>,
): void {
  console.log(JSON.stringify({ event: 'scheduled_job', job, outcome, durationMs, ...summary }));
}

async function runOneJob(
  job: ScheduledJob,
  ctx: { env: Env; sql: SqlClient; asOf: Date; asOfIso: string; capture: CaptureException },
): Promise<TickReportEntry> {
  const started = Date.now();
  const token = crypto.randomUUID();

  const acquired = await acquireJobLease(ctx.sql, job, token, ctx.asOfIso);
  if (!acquired) {
    const durationMs = Date.now() - started;
    logJob(job.name, 'skipped-lease-held', durationMs);
    return { job: job.name, outcome: 'skipped-lease-held', durationMs };
  }

  try {
    const result: JobResult = await job.run({
      env: ctx.env,
      sql: ctx.sql,
      asOf: ctx.asOf,
    });
    const durationMs = Date.now() - started;
    if (result.failed) {
      // Partial/absorbed failure: recorded 'failed' so the job is retried on
      // the next tick, but the summary says which part of the work went wrong.
      await releaseJobLease(ctx.sql, job.name, token, ctx.asOfIso, false, 'reported failed');
      logJob(job.name, 'failed', durationMs, result.summary);
      return { job: job.name, outcome: 'failed', durationMs, summary: result.summary };
    }
    await releaseJobLease(ctx.sql, job.name, token, ctx.asOfIso, true, null);
    logJob(job.name, 'succeeded', durationMs, result.summary);
    return { job: job.name, outcome: 'succeeded', durationMs, summary: result.summary };
  } catch (error) {
    const durationMs = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    ctx.capture(error, { tags: { component: 'scheduled', job: job.name } });
    // Isolation: a throwing job must not strand the rest of the tick, so the
    // release failure is swallowed into the same report entry rather than
    // thrown again.
    await releaseJobLease(ctx.sql, job.name, token, ctx.asOfIso, false, message).catch(
      (releaseError) => {
        console.error(
          JSON.stringify({
            event: 'scheduled_job_lease_release_failed',
            job: job.name,
            message: releaseError instanceof Error ? releaseError.message : String(releaseError),
          }),
        );
      },
    );
    logJob(job.name, 'failed', durationMs, { error: message });
    return { job: job.name, outcome: 'failed', durationMs };
  }
}

/**
 * One cron tick: decide due-ness for every job, run each due job under its
 * lease, and return a report (also logged line-by-line) of every outcome.
 */
export async function runScheduledTick(
  env: Env,
  asOf: Date,
  deps: TickDeps = {},
): Promise<TickReport> {
  if (env.SCHEDULED_JOBS_DISABLED === 'true') {
    console.log(JSON.stringify({ event: 'scheduled_tick', disabled: true }));
    return { asOf: asOf.toISOString(), disabled: true, jobs: [] };
  }

  const sql = deps.sql ?? (neon(getConnectionString(env)) as SqlClient);
  const jobs = deps.jobs ?? SCHEDULED_JOBS;
  const capture: CaptureException =
    deps.captureException ?? ((error, context) => Sentry.captureException(error, context));
  const asOfIso = asOf.toISOString();

  // One SELECT for all run state — each job's due check then costs nothing.
  const stateRows = (await sql`
    SELECT job_name, last_succeeded_at AS "lastSucceededAt" FROM scheduled_job_runs
  `) as JobRunStateRow[];
  const stateByJob = new Map(
    stateRows.map((row) => [
      row.job_name,
      {
        lastSucceededAt: row.lastSucceededAt == null ? null : new Date(row.lastSucceededAt),
      },
    ]),
  );

  const report: TickReport = { asOf: asOfIso, jobs: [] };

  for (const job of jobs) {
    const state = stateByJob.get(job.name);
    if (!isJobDue(job, state, asOf)) {
      logJob(job.name, 'not-due', 0);
      report.jobs.push({ job: job.name, outcome: 'not-due', durationMs: 0 });
      continue;
    }
    report.jobs.push(await runOneJob(job, { env, sql, asOf, asOfIso, capture }));
  }

  return report;
}
