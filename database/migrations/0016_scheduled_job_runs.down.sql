-- Recovery (manual-only, destructive, complete) for migration 0016.
--
-- Drops `scheduled_job_runs`. Any lease or last-run state is lost with the
-- table: a job running at the moment this executes would finish but leave its
-- release UPDATE on a table that no longer exists (failing that statement),
-- and the next tick sees every job as never-run and redoes the day's work.
-- Run it only with the cron trigger disabled or the Worker undeployed.
DROP TABLE IF EXISTS scheduled_job_runs;
