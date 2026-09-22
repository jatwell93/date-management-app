-- Recovery (manual-only, destructive, complete) for migration 0015.
--
-- Drops `processed_webhook_events.completed_at`.
--
-- Destructive in the sense every down migration here is, and in the same way
-- 0012's is: the claim state of any Stripe webhook delivery in flight is lost
-- with the column, so an event claimed but not yet completed becomes
-- indistinguishable from a completed one and will never be re-driven. Its side
-- effects -- a tier change, a cancellation, a period-end update -- would simply
-- not happen, and Stripe's retries would be acknowledged as replays of finished
-- work. Drain webhook traffic and disable the Stripe endpoint before using this.
ALTER TABLE processed_webhook_events
  DROP COLUMN IF EXISTS completed_at;
