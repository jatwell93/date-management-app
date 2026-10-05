-- Recovery (manual-only, destructive, complete) for migration 0019.
--
-- Drops the active-triple unique index. "Destructive" only in the sense every
-- down migration here is: the database stops refusing a duplicate active
-- inventory item, so the Worker's own `WHERE NOT EXISTS` check is the only
-- guard left. No data is affected.
DROP INDEX IF EXISTS inventory_items_active_triple_unique;
