-- Add the current paid-period end and the cancel-at-period-end flag to
-- subscription_tiers. The Worker's GET /api/subscription/current query (added
-- in #337) selects both columns and the SQLite dev Prisma schema declares them,
-- but the production Prisma schema and the Postgres migration series never got
-- them -- so the query fails on a missing column and the endpoint 500s in
-- production. This migration (together with the matching production Prisma
-- fields) closes that gap. Additive / expand-safe: current_period_end is
-- nullable and cancel_at_period_end defaults to false, so no backfill is needed.
--
-- current_period_end is TIMESTAMP(3) (without time zone) to match the other
-- timestamp columns on this table (trial_end_date, past_due_since, ...) and the
-- production Prisma model's `DateTime?` mapping, which resolves to timestamp(3).
ALTER TABLE subscription_tiers
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMP(3);

ALTER TABLE subscription_tiers
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;
