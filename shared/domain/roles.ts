/**
 * Canonical organization roles, and the one place external role spellings are
 * normalized.
 *
 * **Why this module exists.** There were four copies of this logic — Express
 * (`backend/src/constants/roles.ts`), the Worker
 * (`workers/src/constants/roles.ts`), the frontend
 * (`frontend/src/constants/roles.ts`), and two ad-hoc normalizers inside the
 * Worker's Clerk handlers. Three of them carried the comment "Keep in sync with
 * backend/src/constants/roles.ts", and they were not in sync: the Worker's map
 * omitted `owner`, and the Clerk webhook's `mapClerkRole` mapped `org:admin` to
 * the string `'Manager'` — a value no authorization gate in either backend
 * accepts, because every gate compares lowercase. A routine membership
 * redelivery therefore silently downgraded an admin out of admin (issue #517).
 *
 * A comment asking humans to keep four tables identical is not a mechanism.
 * This module is the mechanism, and all three package copies — Express, the
 * Worker and the frontend — now re-export it rather than restating it.
 *
 * One restatement survives on purpose: `backend/scripts/backfill-canonical-roles.js`
 * is CommonJS run by bare `node`, so it cannot import this module, and its
 * retirement is task 3.4's call rather than this change's. Its table is
 * annotated there with what it must mirror and why it cannot simply import.
 *
 * **Least privilege on the way in.** An unrecognized spelling normalizes to
 * `team_member`, never to a privileged role. That is why the alias table is
 * exhaustive about the *privileged* spellings in particular: a missing
 * `org:admin` entry silently demotes an administrator, which is the failure
 * this module was extracted to end.
 */

export const ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  TEAM_MEMBER: 'team_member',
} as const;

export type RoleValue = (typeof ROLES)[keyof typeof ROLES];

/** The canonical values, for validation and for iterating in tests. */
export const CANONICAL_ROLES: readonly RoleValue[] = [
  ROLES.ADMIN,
  ROLES.MANAGER,
  ROLES.TEAM_MEMBER,
];

/**
 * Every external or legacy spelling this system has ever accepted, mapped to a
 * canonical value.
 *
 * Sources folded together here:
 *   * Clerk membership roles (`org:admin`, `org:member`, …) — the live ingress.
 *   * Clerk's `owner`, which only the bootstrap path previously handled. The
 *     Worker's copy omitted it, so the same Clerk role normalized differently
 *     depending on which handler saw it first.
 *   * Express-era database spellings (`'Manager'`, `'Team Member'`, `Staff`).
 *     These are not written by any live path — the Express create route
 *     validates `z.enum(['admin','manager','team_member'])`
 *     (`backend/src/schemas/index.ts:32`), and the middleware that accepted the
 *     title-case pair (`validateUserInput`) is referenced only by its own test.
 *
 *     Migration 0014 rewrites the spellings a path actually wrote (`'Manager'`,
 *     `'Team Member'`) plus every other no-privilege variant. It deliberately
 *     does **not** rewrite the privileged aliases — `Admin`, `ADMIN`, `owner`,
 *     `org:admin` — because no writer in this repo has produced them, and
 *     promoting a row on the strength of a spelling is a grant rather than a
 *     normalization. They stay readable here instead, which is sufficient:
 *     every authorization gate normalizes before comparing, so a row holding
 *     one still resolves to the role it means.
 *
 * Canonical values map to themselves, so `normalizeRole` is idempotent —
 * `normalizeRole(normalizeRole(x)) === normalizeRole(x)` for every input. The
 * 0014 backfill relies on that: it can be replayed over its own result.
 */
export const ROLE_ALIASES: Record<string, RoleValue> = {
  owner: ROLES.ADMIN,
  admin: ROLES.ADMIN,
  Admin: ROLES.ADMIN,
  ADMIN: ROLES.ADMIN,
  'org:admin': ROLES.ADMIN,
  manager: ROLES.MANAGER,
  Manager: ROLES.MANAGER,
  MANAGER: ROLES.MANAGER,
  'org:manager': ROLES.MANAGER,
  member: ROLES.TEAM_MEMBER,
  team_member: ROLES.TEAM_MEMBER,
  'team-member': ROLES.TEAM_MEMBER,
  'Team Member': ROLES.TEAM_MEMBER,
  Team_Member: ROLES.TEAM_MEMBER,
  TEAM_MEMBER: ROLES.TEAM_MEMBER,
  Staff: ROLES.TEAM_MEMBER,
  staff: ROLES.TEAM_MEMBER,
  'org:member': ROLES.TEAM_MEMBER,
  'org:team_member': ROLES.TEAM_MEMBER,
};

/**
 * Normalize any role string to a canonical value.
 *
 * Unknown, empty and non-string values become `team_member` — least privilege,
 * and deliberately not an exception: this runs on webhook payloads and on
 * stored rows, where throwing would turn an unfamiliar spelling into a failed
 * delivery or a 500 rather than a safe demotion.
 */
export function normalizeRole(role: string | null | undefined): RoleValue {
  if (typeof role !== 'string' || role === '') return ROLES.TEAM_MEMBER;
  return ROLE_ALIASES[role] ?? ROLES.TEAM_MEMBER;
}

/** Type guard: is this already one of the canonical values? */
export function isCanonicalRole(role: string): role is RoleValue {
  return (CANONICAL_ROLES as readonly string[]).includes(role);
}
