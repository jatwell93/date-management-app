-- Recovery (manual-only, destructive, complete) for migration 0012.
--
-- Drops the unique constraint on subscription_tiers.organization_id, restores
-- the plain index it replaced, and drops clerk_webhook_events.completed_at.
--
-- Destructive in the sense every down migration here is: the claim state of any
-- webhook delivery in flight is lost with the column, so an event claimed but
-- not yet completed becomes indistinguishable from a completed one and will not
-- be re-driven. Drain webhook traffic before using this.
ALTER TABLE subscription_tiers
  DROP CONSTRAINT IF EXISTS subscription_tiers_organization_id_key;

CREATE INDEX IF NOT EXISTS subscription_tiers_organization_id_idx
  ON subscription_tiers (organization_id);

ALTER TABLE clerk_webhook_events
  DROP COLUMN IF EXISTS completed_at;
