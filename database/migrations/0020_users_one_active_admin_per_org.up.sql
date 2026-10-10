-- Migration 0020: at most one active admin per organization.
--
-- Bootstrap decided "is this the first admin?" with a read followed by a write
-- (#474). Neon's HTTP driver has no transaction, and two first sign-ins insert
-- different clerk_user_ids that contend on no common row, so both read zero admins
-- and both were assigned `admin`. Only the database can close that race.
--
-- The index also makes a second admin impossible on every path, including the
-- two that used to mint one on purpose (`POST /api/users`, `PUT /api/users/:id`).
-- The reviewer decided on 2026-10-10 that one admin per organization is the model.
-- Clerk-driven grants (bootstrap and the membership webhook) store `manager`
-- instead of failing when the slot is taken; the HTTP paths answer 409.
--
-- Partial on `deleted_at IS NULL`, so a soft-deleted admin does not hold the slot.
--
-- The build fails if an organization already has two active admins. That is
-- intended: it must not silently pick a survivor.
--
-- Idempotent on replay: `IF NOT EXISTS` is a no-op over its own result, which
-- the forward-fix path in `e2e.test.ts` requires.
CREATE UNIQUE INDEX IF NOT EXISTS users_one_active_admin_per_org
  ON users (organization_id)
  WHERE role = 'admin' AND deleted_at IS NULL;
