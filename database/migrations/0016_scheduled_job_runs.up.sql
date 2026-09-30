-- Migration 0016: run-state + lease table for the Worker's scheduled jobs
-- (Cron Trigger dispatch in workers/src/scheduled/).
--
-- The row per job serves two purposes that the cron tick cannot get any other
-- way:
--
--   1. Overlap prevention. A cron tick is at-least-once and two ticks can be
--      running in different isolates at the same time (a slow job overlapping
--      the next hourly tick, or a retried delivery). `lease_token` +
--      `lease_expires_at` let the dispatcher claim a job in a single
--      `INSERT ... ON CONFLICT DO UPDATE ... WHERE lease_expires_at <= $asOf
--      RETURNING job_name`, so a second tick loses the claim instead of running
--      the job twice. The lease has an expiry because a crashed isolate never
--      gets to release.
--
--   2. Catch-up. `last_succeeded_at` records the *scheduled* instant a tick
--      last completed, not wall-clock NOW(), so `isJobDue` can compare a missed
--      daily slot against it and a delayed tick still does the day's work
--      rather than seeing itself as "already ran today".
--
-- The Express implementation's `JobLockRepository` was broken rather than
-- portable (audit Finding 14, retired at Phase 4): its acquire was
-- `INSERT INTO migrations (name, appliedAt)`, naming the Prisma *field*
-- `appliedAt` where the Postgres column is `applied_at`, so it always threw;
-- the catch checked `SQLITE_CONSTRAINT` (not Postgres's `23505`) and fell
-- through to `return false`, which the only caller — the dormant
-- daily-metrics job — logged as "already running". Every run therefore
-- self-skipped silently, and nothing in the Express scheduler ever had working
-- overlap prevention.
--
-- Session advisory locks would not have fixed it here anyway: the Neon HTTP
-- driver sends each statement on its own session, so a `pg_advisory_lock`
-- taken in one statement cannot span a job's other statements and is released
-- when that statement's session ends. A row-state lease works because the
-- acquire is a single self-contained conditional upsert — the claim, the
-- staleness check and the takeover all happen inside one statement.
--
-- `job_name` is the primary key rather than a separate id: a job must never
-- have two rows, and the key is what the dispatcher's ON CONFLICT targets.
-- `last_status` is free-form text ('running' | 'succeeded' | 'failed') rather
-- than an enum — the dispatcher writes all three values and nothing else reads
-- them; a CHECK would only constrain future observers. `last_error` is
-- truncated to 2000 chars by the writer so a pathological stack cannot grow
-- the row unboundedly.
--
-- Idempotent on replay: `CREATE TABLE IF NOT EXISTS` is a no-op over its own
-- result, which the forward-fix path in `e2e.test.ts` requires.
CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  job_name          TEXT PRIMARY KEY,
  lease_token       TEXT,
  lease_expires_at  TIMESTAMP(3),
  last_started_at   TIMESTAMP(3),
  last_finished_at  TIMESTAMP(3),
  last_succeeded_at TIMESTAMP(3),
  last_status       TEXT,
  last_error        TEXT,
  updated_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
