-- Recovery for canonical PostgreSQL baseline (Phase 1 task 1.3).
--
-- Manual-only, destructive, complete: reverses exactly what 0000_baseline.up.sql
-- created — the 20 pre-delta tables and their indexes/constraints/FKs. Does NOT
-- drop objects created by later migrations (0001-0009) or the runner's
-- schema_migrations ledger; those are owned by their respective migrations and
-- the runner. CASCADE removes FK constraints from migration-added tables that
-- reference baseline tables, but does not drop the migration-added tables
-- themselves.
--
-- This recovery is a nuclear reset of the baseline layer — all data in the
-- baseline tables is lost. Use only as part of an explicitly reviewed recovery
-- decision where total data loss is acceptable; otherwise recovery is a forward
-- fix or Neon restore.

-- Drop baseline tables in reverse dependency order. CASCADE handles any FK
-- constraints from migration-added tables that reference these tables.
DROP TABLE IF EXISTS "webhook_metrics" CASCADE;
DROP TABLE IF EXISTS "metrics_snapshots" CASCADE;
DROP TABLE IF EXISTS "migrations" CASCADE;
DROP TABLE IF EXISTS "uploads" CASCADE;
DROP TABLE IF EXISTS "expired_item_transactions" CASCADE;
DROP TABLE IF EXISTS "item_transactions" CASCADE;
DROP TABLE IF EXISTS "audit_log" CASCADE;
DROP TABLE IF EXISTS "refresh_tokens" CASCADE;
DROP TABLE IF EXISTS "organization_invites" CASCADE;
DROP TABLE IF EXISTS "users" CASCADE;
DROP TABLE IF EXISTS "store_areas" CASCADE;
DROP TABLE IF EXISTS "inventory_items" CASCADE;
DROP TABLE IF EXISTS "products" CASCADE;
DROP TABLE IF EXISTS "clerk_webhook_events" CASCADE;
DROP TABLE IF EXISTS "processed_webhook_events" CASCADE;
DROP TABLE IF EXISTS "organization_usage" CASCADE;
DROP TABLE IF EXISTS "tier_feature_flags" CASCADE;
DROP TABLE IF EXISTS "trial_events" CASCADE;
DROP TABLE IF EXISTS "subscription_tiers" CASCADE;
DROP TABLE IF EXISTS "organizations" CASCADE;
