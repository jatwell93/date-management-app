-- Migration 0018: remove the legacy `role = 'user'` accounts and make
-- `users.role` canonical by constraint. Issue #560.
--
-- 1. Delete the accounts the removed `POST /api/auth/register` route created.
--    That route (removed in #560) inserted users with no authentication into
--    the oldest organization with the non-canonical role 'user'. Production
--    held 18 such rows, all in the placeholder `default-org`, all without a
--    Clerk id, created 2026-03-28 to 2026-04-05 and nothing since. None can
--    sign in: identity is Clerk-only and they have no Clerk id. Before writing
--    this, a read-only check on production found nothing referencing them --
--    0 rows in each of uploads and organization_invites (which would CASCADE)
--    and in audit_log, item_transactions, expired_item_transactions,
--    bay_checks, catalogue_corrections, credit_claims and credit_claim_events
--    (which would SET NULL). The predicate names all three properties, so it
--    can only ever match rows of that shape, on any database.
--
-- 2. Add `users_role_canonical`. Migration 0014 normalised the values but left
--    the column free text, so any writer could reintroduce a spelling the
--    authorization gates do not recognise -- which is exactly what the
--    register route did. Every live writer already writes a canonical value
--    (Clerk paths through `normalizeRole`, the user-management routes through
--    an allowlist), so the constraint changes no behaviour; it turns the
--    convention into a guarantee.
--
--    Adding it validates every existing row. If any other non-canonical value
--    exists, the statement fails and, because this migration is
--    transactional, the delete above is rolled back with it. That is the
--    intended outcome: such a row needs a decision, not a silent rewrite.
--
-- Idempotent on replay, as the forward-fix path in `e2e.test.ts` requires: the
-- delete matches nothing the second time, and Postgres has no
-- `ADD CONSTRAINT IF NOT EXISTS`, so the constraint is added only when absent.

DELETE FROM users
WHERE organization_id = 'default-org'
  AND role = 'user'
  AND clerk_user_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_role_canonical'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_canonical
      CHECK (role IN ('admin', 'manager', 'team_member'));
  END IF;
END
$$;
