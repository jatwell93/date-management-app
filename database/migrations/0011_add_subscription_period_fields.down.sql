ALTER TABLE subscription_tiers
  DROP COLUMN IF EXISTS cancel_at_period_end;

ALTER TABLE subscription_tiers
  DROP COLUMN IF EXISTS current_period_end;
