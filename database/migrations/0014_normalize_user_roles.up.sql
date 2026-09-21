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
-- 'Team Member' needs no such split: it carries no privilege either way.
--
-- IDEMPOTENT by construction. Each statement matches only the non-canonical
-- spelling it replaces, so a replay over its own result updates zero rows.
-- That matters because the documented forward-fix recovery path unstamps every
-- migration above the one being fixed and re-applies them against the existing
-- schema.

UPDATE users
SET role = 'admin', updated_at = NOW()
WHERE role = 'Manager'
  AND clerk_user_id IS NOT NULL;

UPDATE users
SET role = 'manager', updated_at = NOW()
WHERE role = 'Manager'
  AND clerk_user_id IS NULL;

UPDATE users
SET role = 'team_member', updated_at = NOW()
WHERE role = 'Team Member';
