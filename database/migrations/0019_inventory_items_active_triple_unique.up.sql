-- Migration 0019: one active inventory item per product, expiry date and location.
--
-- Express refused a second `inventory_items` row with the same `product_id`,
-- `expiry_date` and `location_id` (409, `data-integrity.middleware`). The Worker
-- inserted unconditionally, and the table has no quantity column, so a
-- duplicate counted as a second unit against the tier's active-expiry cap.
-- Task 3.10 of retire-express-unify-on-postgres rebuilds the rule here.
--
-- The key is scoped to the organization, and it is partial: items in a
-- terminal status (the same list as `TERMINAL_INVENTORY_STATUSES` in
-- workers/src/database.ts) do not block re-adding the same triple. Express
-- blocked on any row regardless of status; the reviewer decided on 2026-10-05
-- that a discarded or sold-through item must not lock the triple forever.
--
-- The build fails if active duplicates already exist. That is intended: it
-- must not silently pick a survivor. Run the read-only duplicate check from
-- task 3.10 before applying.
--
-- Idempotent on replay: `IF NOT EXISTS` is a no-op over its own result, which
-- the forward-fix path in `e2e.test.ts` requires.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_active_triple_unique
  ON inventory_items (organization_id, product_id, expiry_date, location_id)
  WHERE status <> ALL (ARRAY['Processed', 'Completed', 'Discarded', 'Archived', 'Sold Through']);
