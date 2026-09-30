-- Recovery (manual-only, destructive, complete) for migration 0017.
--
-- Drops the `processed_at` index. "Destructive" only in the sense every down
-- migration here is: the hourly webhook-monitoring job's replay-growth query
-- goes back to scanning the table, which gets slower as the table grows. No
-- data is affected.
DROP INDEX IF EXISTS processed_webhook_events_processed_at_idx;
