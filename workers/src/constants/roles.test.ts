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
import { isCanonicalRole, ROLE_ALIASES, ROLES, canUpload, normalizeRole } from './roles';

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
