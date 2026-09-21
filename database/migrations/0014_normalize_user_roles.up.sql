-- Normalize non-canonical users.role values written by the Clerk webhook.
--
-- Issue #517. `mapClerkRole` (workers/src/clerk/clerk-persistence.ts) stored
-- exactly two values: 'Manager' for Clerk's `admin` / `org:admin`, and
-- 'Team Member' for everything else. Neither is a canonical role, and every
-- authorization gate compares canonical lowercase -- so a stored 'Manager'
-- matched nothing and the user lost both user management and supplier-policy
-- writes. Because `organizationMembership.created` overwrites `users.role`
-- unconditionally and Clerk redelivers, this silently downgraded admins who
-- had bootstrapped correctly.
--
-- The code fix lands with this migration; these statements repair the rows the
-- old code already wrote.
--
-- WHY 'Manager' SPLITS ON clerk_user_id, AND WHY THAT IS NOT AN ESCALATION.
-- The title-case spelling has two possible origins, and they mean different
-- things:
--
--   * Clerk-originated rows (clerk_user_id IS NOT NULL) were written by
--     mapClerkRole, which produced 'Manager' if and only if Clerk sent `admin`
--     or `org:admin`. Those users ARE administrators; 'admin' restores exactly
--     what the bootstrap path writes for the same Clerk role. Mapping them to
--     'manager' instead would leave the reported bug unfixed -- the three
--     supplier-policy gates normalize before comparing and would still refuse
--     them.
--
--   * Rows with no clerk_user_id predate Clerk. The live Express create route
--     validates z.enum(['admin','manager','team_member'])
--     (backend/src/schemas/index.ts:32), so it cannot produce this spelling
--     today; the middleware that accepted it (validateUserInput) is referenced
--     only by its own test. Any such row is therefore legacy, its spelling
--     meant an actual manager, and it is normalized to 'manager' -- the least
--     privilege reading, and no grant this database did not already record.
--
-- 'Team Member' needs no such split: it carries no privilege either way, and
-- the same statement sweeps up every other no-privilege spelling in
-- shared/domain/roles.ts (ROLE_ALIASES) so none is left behind. users.role is
-- free TEXT with no CHECK constraint, so a residual non-canonical row would
-- never be rejected or flagged -- it would simply sit there.
--
-- The privileged aliases -- 'Admin', 'ADMIN', 'owner', 'org:admin' -- are
-- deliberately NOT rewritten. No writer in this repo has ever produced them, so
-- a row holding one is hypothetical, and promoting it would be a grant made on
-- the strength of a spelling rather than a normalization. Every authorization
-- gate normalizes before comparing (the #517 fix did that too), so such a row
-- still resolves to the role it means without this migration touching it.
--
-- IDEMPOTENT by construction. Each statement matches only the non-canonical
-- spelling it replaces, so a replay over its own result updates zero rows.
-- That matters because the documented forward-fix recovery path unstamps every
-- migration above the one being fixed and re-applies them against the existing
-- schema.
--
-- DEPLOY ORDER -- read this before assuming one run is enough. In
-- .github/workflows/workers-deploy.yml the deploy job declares
-- `needs: [migration-prep-production]`, so this migration is applied BEFORE the
-- fixed Worker ships. For that window the old mapClerkRole is still live, and
-- organizationMembership.created overwrites users.role unconditionally -- so a
-- Clerk redelivery landing between the apply and the deploy re-writes
-- 'Manager' after this backfill has already passed over it, and nothing
-- re-applies this file on its own. The affected admin is broken again until
-- their next membership event arrives under the new code.
--
-- The idempotency above is what makes the remedy cheap: once the deploy
-- completes, confirm nothing is left with
--
--   SELECT role, COUNT(*) FROM users
--   WHERE role NOT IN ('admin', 'manager', 'team_member')
--   GROUP BY role;
--
-- Grouped rather than counted on purpose. A bare COUNT cannot reach zero if any
-- row holds one of the privileged aliases this migration deliberately preserves
-- ('Admin', 'ADMIN', 'owner', 'org:admin') -- it would tell an operator to
-- re-run a migration that by design will not change them. Grouping separates
-- the two cases: the spellings above mean re-apply this file; the preserved
-- aliases mean do nothing.
--
-- That step is in docs/plans/2026-04-19-rbac-rollout-runbook.md.

UPDATE users
SET role = 'admin', updated_at = NOW()
WHERE role = 'Manager'
  AND clerk_user_id IS NOT NULL;

UPDATE users
SET role = 'manager', updated_at = NOW()
WHERE role = 'Manager'
  AND clerk_user_id IS NULL;

UPDATE users
SET role = 'manager', updated_at = NOW()
WHERE role IN ('MANAGER', 'org:manager');

UPDATE users
SET role = 'team_member', updated_at = NOW()
WHERE role IN (
  'Team Member',
  'Team_Member',
  'TEAM_MEMBER',
  'team-member',
  'member',
  'Staff',
  'staff',
  'org:member',
  'org:team_member'
);
