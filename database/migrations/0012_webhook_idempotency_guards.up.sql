-- Migration 0012: give webhook processing a database-level idempotency claim,
-- and make the trial-subscription write idempotent independently.
--
-- Two related gaps (issue #472):
--
-- 1. `clerk_webhook_events` records only *that* an event was processed, with no
--    way to express "a delivery has claimed this event and is still working on
--    it". The Worker therefore had to read-then-write across three statements,
--    so two concurrent Svix deliveries of one event id both observed "new" and
--    both performed the side effects. `completed_at` splits the row's life into
--    claimed (`completed_at IS NULL`) and finished, which lets the claim be a
--    single `INSERT ... ON CONFLICT ... RETURNING` and lets a claim abandoned
--    by a crashed isolate be re-driven after a staleness window.
--
--    Every row that exists when this runs records finished work, and so does
--    every row an *old* Worker writes during the deploy gap -- it inserts its
--    marker after processing and never mentions `completed_at`. Both cases are
--    handled by the column default rather than by a backfill: `DEFAULT
--    CURRENT_TIMESTAMP` on a non-volatile expression is evaluated once at DDL
--    time and stored as the attribute's missing value, so existing rows read as
--    completed with no table rewrite, no WAL spike and no dead tuples, and rows
--    inserted later without the column are born completed. The stored instant is
--    "at or before the migration", not the true completion time; nothing reads
--    the value, only whether it is NULL.
--
--    The new Worker's claim always writes `completed_at` explicitly as NULL, so
--    the default never applies to it. That is load-bearing: any future writer of
--    this table must name the column, or its row is born completed and the event
--    it represents will never be processed.
--
-- 2. `subscription_tiers` has no unique index on `organization_id`, yet every
--    reader in both backends selects a single row per organization with
--    `LIMIT 1`. The one writer (`ensureTrialSubscription`) was check-then-insert
--    with nothing behind it, so a doubled `organization.created` could write two
--    `trialing` rows for one organization and make tier resolution, trial expiry
--    and billing state order-dependent. The unique constraint is what actually
--    makes that write idempotent; the `ON CONFLICT DO NOTHING` in the Worker
--    relies on it.
--
-- The constraint is added only if the table already satisfies it. Duplicates
-- are a data-repair decision, not something a migration should silently make by
-- deleting rows, so the guard below aborts the transaction and names the
-- affected organizations. Remediate with:
--
--   SELECT organization_id, count(*), array_agg(id ORDER BY id)
--   FROM subscription_tiers GROUP BY organization_id HAVING count(*) > 1;
--
-- Deployment order: this migration must land before the Worker that assumes it
-- (`migrate:apply` runs ahead of the Worker deploy in workers-deploy.yml). An
-- old Worker running against the new constraint is safe: its check-then-insert
-- race now raises a unique violation and returns 500, which Svix retries,
-- instead of silently writing a second row.
--
-- Locking: the ADD CONSTRAINT below takes ACCESS EXCLUSIVE on subscription_tiers
-- while it builds the index. It is not guarded here because the runner already
-- guards it -- `configureSession` (src/database/migrations/runner.ts:396-400)
-- sets `lock_timeout = '10s'` and `statement_timeout = '5min'` on the session
-- before any migration is applied, so a migration that would queue behind a
-- long-running query fails fast and rolls back instead of stalling the table.
-- A `SET LOCAL` here would be narrower than what is already in force.
--
-- The SQLite dev schema (`backend/prisma/schema.prisma`) is deliberately NOT
-- given the matching `@@unique`, against the general "update both schemas" rule
-- in docs/database-migrations.md:296. This migration never runs against SQLite;
-- more importantly, Express's own `createSubscription`
-- (services/subscription-billing-lifecycle.service.ts:69) inserts a fresh row
-- per Stripe subscription, so the constraint would break the rollback backend's
-- paid-conversion path in dev for no production benefit. The dev schema's
-- datasource is sqlite, so no `db push` from it can reach Postgres.
ALTER TABLE clerk_webhook_events
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

DO $$
DECLARE
  duplicate_organizations text;
BEGIN
  SELECT string_agg(organization_id, ', ' ORDER BY organization_id)
  INTO duplicate_organizations
  FROM (
    SELECT organization_id
    FROM subscription_tiers
    GROUP BY organization_id
    HAVING count(*) > 1
  ) AS duplicates;

  IF duplicate_organizations IS NOT NULL THEN
    RAISE EXCEPTION
      'subscription_tiers holds more than one row for organization(s): %. Resolve the duplicates before applying migration 0012.',
      duplicate_organizations;
  END IF;
END
$$;

DROP INDEX IF EXISTS subscription_tiers_organization_id_idx;

ALTER TABLE subscription_tiers
  DROP CONSTRAINT IF EXISTS subscription_tiers_organization_id_key;
ALTER TABLE subscription_tiers
  ADD CONSTRAINT subscription_tiers_organization_id_key UNIQUE (organization_id);
