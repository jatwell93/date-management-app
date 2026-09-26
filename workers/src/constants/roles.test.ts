/**
 * Coverage for the canonical role helpers.
 *
 * `constants/roles.ts` is live production code: `index-minimal.ts:84` imports
 * `normalizeRole`/`ROLES`, and three admin gates gate on it
 * (`handleWriteSupplierPolicy`, `handleClearSupplierPolicy`,
 * `handleBulkAttachPolicy`). Until this file existed the only test touching
 * these helpers was `middleware/require-role.test.ts`, which sat behind the
 * undeployed `index.ts` entry point and was removed with that layer
 * (audit 2.5 Finding 22, task 3.1.0). The behaviours below are carried over
 * from it; the Express `req`/`res`/`next` wrapper assertions were not, because
 * no live Worker path has that shape.
 */
import { describe, expect, it } from 'vitest';
import {
  isCanonicalRole,
  ROLE_ALIASES,
  ROLES,
  canUpload,
  hasOrgRole,
  normalizeRole,
} from './roles';

describe('normalizeRole', () => {
  it.each([
    ['org:admin', ROLES.ADMIN],
    ['admin', ROLES.ADMIN],
    ['Admin', ROLES.ADMIN],
    ['ADMIN', ROLES.ADMIN],
  ])('maps %s to the canonical admin role', (input, expected) => {
    expect(normalizeRole(input)).toBe(expected);
  });

  it.each([
    ['org:manager', ROLES.MANAGER],
    ['manager', ROLES.MANAGER],
    ['Manager', ROLES.MANAGER],
    ['MANAGER', ROLES.MANAGER],
  ])('maps %s to the canonical manager role', (input, expected) => {
    expect(normalizeRole(input)).toBe(expected);
  });

  it.each([
    ['org:member', ROLES.TEAM_MEMBER],
    ['org:team_member', ROLES.TEAM_MEMBER],
    ['team-member', ROLES.TEAM_MEMBER],
    ['Team Member', ROLES.TEAM_MEMBER],
    ['member', ROLES.TEAM_MEMBER],
    ['Staff', ROLES.TEAM_MEMBER],
    ['staff', ROLES.TEAM_MEMBER],
  ])('maps %s to the canonical team-member role', (input, expected) => {
    expect(normalizeRole(input)).toBe(expected);
  });

  // The admin gates compare `normalizeRole(role) !== ROLES.ADMIN`, so anything
  // that does not normalize to a known role must land on the least-privileged
  // value rather than pass through unchanged.
  it.each([['org:billing'], ['superuser'], ['']])(
    'defaults the unrecognised role %j to team_member rather than passing it through',
    (input) => {
      expect(normalizeRole(input)).toBe(ROLES.TEAM_MEMBER);
    },
  );

  /**
   * `owner` moved out of the list above when this module started re-exporting
   * `shared/domain/roles.ts` (issue #517), and the move is deliberate rather
   * than incidental.
   *
   * It was never an unknown spelling — it was a known one this copy had
   * omitted. `normalizeBootstrapRole` in the same Worker mapped `owner` to
   * `admin`, and so does Express's table. So the outcome for a Clerk owner
   * depended on which handler saw them first: admin if they loaded a page,
   * team_member if a webhook arrived. That is the same class of divergence as
   * the `'Manager'` defect, one table over.
   *
   * This is not a widening of who can reach admin: the bootstrap path already
   * granted it for this spelling, so the privilege was always one page load
   * away. What changes is that the two paths now agree.
   */
  it('maps owner to admin, matching the bootstrap path and Express', () => {
    expect(normalizeRole('owner')).toBe(ROLES.ADMIN);
  });

  it.each([[null], [undefined]])('defaults absent role %j to team_member', (input) => {
    expect(normalizeRole(input)).toBe(ROLES.TEAM_MEMBER);
  });

  it('never returns admin for any input outside the admin mappings', () => {
    const adminInputs = ['org:admin', 'admin', 'Admin', 'ADMIN', 'owner'];
    // Note the two near-misses kept in this list on purpose: `'ADMIN '` with a
    // trailing space and `'org:Admin'`. The table is an exact-match lookup, not
    // a case-folding or trimming one, so a spelling that merely *looks*
    // privileged still lands on team_member. That is the safe direction, and it
    // is the property worth pinning — an alias table that quietly started
    // matching loosely would grant admin on typos.
    const others = ['org:manager', 'org:member', 'staff', '', 'ADMIN ', 'org:Admin'];

    for (const input of others) {
      expect(adminInputs).not.toContain(input);
      expect(normalizeRole(input)).not.toBe(ROLES.ADMIN);
    }
  });
});

describe('canUpload', () => {
  it('allows admin to upload', () => {
    expect(canUpload(ROLES.ADMIN)).toBe(true);
  });

  it('allows manager to upload', () => {
    expect(canUpload(ROLES.MANAGER)).toBe(true);
  });

  it('blocks team_member from uploading', () => {
    expect(canUpload(ROLES.TEAM_MEMBER)).toBe(false);
  });

  it('blocks a legacy Clerk role string that normalizes to team_member', () => {
    expect(canUpload(normalizeRole('org:member'))).toBe(false);
  });

  it('allows a legacy Clerk role string that normalizes to manager', () => {
    expect(canUpload(normalizeRole('org:manager'))).toBe(true);
  });
});

/**
 * Properties of the shared alias table itself (issue #517).
 *
 * The defect was not a wrong mapping — it was four mappings that were each
 * locally reasonable and mutually inconsistent. So these cases are about the
 * table as a whole rather than about individual spellings: that it is closed
 * under itself, that it fails towards least privilege, and that the set of
 * spellings reaching admin is fixed and small.
 */
describe('the shared alias table', () => {
  /**
   * Idempotence is not cosmetic. Migration 0014 matches stored spellings, and
   * the documented forward-fix recovery path replays every migration above the
   * one being fixed against the existing schema. A table whose canonical values
   * did not map to themselves would make that replay move rows a second time.
   */
  it('is idempotent over every alias it declares', () => {
    for (const alias of Object.keys(ROLE_ALIASES)) {
      const once = normalizeRole(alias);
      expect(normalizeRole(once)).toBe(once);
    }
  });

  it('only ever produces canonical values', () => {
    for (const input of [...Object.keys(ROLE_ALIASES), '', 'nonsense', 'org:whatever']) {
      expect(isCanonicalRole(normalizeRole(input))).toBe(true);
    }
  });

  /**
   * Keys inherited from `Object.prototype`, which a plain object literal would
   * have answered with a *function* rather than falling through to the default:
   * `{}['constructor']` is truthy, so `?? ROLES.TEAM_MEMBER` never fires and
   * `normalizeRole` would hand a function to a database write or an
   * authorization comparison.
   *
   * Every one of the four copies this table replaced had that shape. None were
   * reachable by an attacker — Clerk payloads and JWT claims are signed — but
   * that is a property of today's callers, not of the table, and the function's
   * declared return type said `RoleValue` regardless. Raised by Copilot on
   * PR #521.
   */
  it('has a null prototype, so no lookup can inherit one', () => {
    expect(Object.getPrototypeOf(ROLE_ALIASES)).toBeNull();
    // The assertion that actually bites: on a plain literal each of these is a
    // function, and `?? ROLES.TEAM_MEMBER` never fires because a function is
    // truthy.
    for (const key of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect((ROLE_ALIASES as Record<string, unknown>)[key]).toBeUndefined();
    }
  });

  it.each([['constructor'], ['toString'], ['valueOf'], ['hasOwnProperty'], ['__proto__']])(
    'returns team_member for the inherited key %j rather than a function',
    (key) => {
      const result = normalizeRole(key);
      expect(typeof result).toBe('string');
      expect(result).toBe(ROLES.TEAM_MEMBER);
    },
  );

  /**
   * The set of spellings that reach admin, asserted as data. This is what stops
   * a later edit from adding a loose match — a `toLowerCase()` or a
   * `startsWith` — that would grant administrator on a near miss, and it makes
   * adding a privileged alias a deliberate act that fails here first.
   */
  it('grants admin only to the declared admin aliases', () => {
    const adminAliases = Object.entries(ROLE_ALIASES)
      .filter(([, value]) => value === ROLES.ADMIN)
      .map(([key]) => key)
      .sort();

    expect(adminAliases).toEqual(['ADMIN', 'Admin', 'admin', 'org:admin', 'owner']);
  });

  /**
   * The two spellings at the centre of #517. They arrive as *stored rows*
   * rather than Clerk payloads, because the old webhook wrote them. Migration
   * 0014 rewrites them, but the table must keep reading them for as long as any
   * database might still hold one — including a replica mid-rollout.
   */
  it('still reads the spellings migration 0014 rewrites', () => {
    expect(normalizeRole('Manager')).toBe(ROLES.MANAGER);
    expect(normalizeRole('Team Member')).toBe(ROLES.TEAM_MEMBER);
    expect(isCanonicalRole('Manager')).toBe(false);
    expect(isCanonicalRole('Team Member')).toBe(false);
  });
});

describe('hasOrgRole', () => {
  it('admits a listed role and refuses an unlisted one', () => {
    expect(hasOrgRole('admin', ROLES.ADMIN, ROLES.MANAGER)).toBe(true);
    expect(hasOrgRole('manager', ROLES.ADMIN, ROLES.MANAGER)).toBe(true);
    expect(hasOrgRole('team_member', ROLES.ADMIN, ROLES.MANAGER)).toBe(false);
  });

  it('normalizes before comparing, so a stored or Clerk spelling still resolves', () => {
    // The #517 failure was a raw comparison refusing an actual admin.
    expect(hasOrgRole('org:admin', ROLES.ADMIN)).toBe(true);
    expect(hasOrgRole('Manager', ROLES.ADMIN, ROLES.MANAGER)).toBe(true);
    expect(hasOrgRole('owner', ROLES.ADMIN)).toBe(true);
  });

  /**
   * The case `normalizeRole` alone gets wrong for a gate. `normalizeRole(null)`
   * is `team_member` by design -- least privilege for a stored value -- so
   * without an explicit guard, a gate listing `team_member` would admit a caller
   * with no role at all. Express refuses a missing role ahead of the allow list
   * in both of its decision paths (`requireOrgRole` at
   * `backend/src/middleware/requireOrgRole.ts:40-43`, and `assertOrgRole` at
   * `:19-20`), and this module exists to keep those two decisions from drifting.
   *
   * No Worker gate lists `team_member` today, so this pins a property rather
   * than a behaviour any live route depends on -- which is exactly why it needs
   * a test: nothing else would fail if the guard were dropped.
   */
  it('refuses an absent role even when team_member is allowed', () => {
    expect(hasOrgRole(null, ROLES.TEAM_MEMBER)).toBe(false);
    expect(hasOrgRole(undefined, ROLES.TEAM_MEMBER)).toBe(false);
    expect(hasOrgRole('', ROLES.TEAM_MEMBER)).toBe(false);
    // An unrecognized *string* still normalizes to team_member, as Express does:
    // its guard is on absence, not on recognition.
    expect(hasOrgRole('some-unknown-role', ROLES.TEAM_MEMBER)).toBe(true);
  });

  it('refuses everything when the allow list is empty', () => {
    expect(hasOrgRole('admin')).toBe(false);
  });
});
