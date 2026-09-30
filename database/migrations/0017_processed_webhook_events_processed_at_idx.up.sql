-- Migration 0017: index `processed_webhook_events.processed_at`.
--
-- The hourly `webhook-monitoring` scheduled job (workers/src/scheduled/) counts
-- processed events in the last two hourly windows — a range scan on
-- `processed_at`. The table only ever grows: completed rows are the audit
-- trail for claim ownership and are never deleted, so the scan would degrade
-- into a full-table read on every hourly run. The existing composite
-- index `(event_type, processed_at)` cannot serve a predicate that does not
-- constrain `event_type`.
--
-- Idempotent on replay: `IF NOT EXISTS` is a no-op over its own result, which
-- the forward-fix path in `e2e.test.ts` requires.
CREATE INDEX IF NOT EXISTS processed_webhook_events_processed_at_idx
  ON processed_webhook_events (processed_at);
