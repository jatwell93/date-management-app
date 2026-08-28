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
import { ROLES, canUpload, normalizeRole } from './roles';

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
  it.each([['owner'], ['org:billing'], ['superuser'], ['']])(
    'defaults the unrecognised role %j to team_member rather than passing it through',
    (input) => {
      expect(normalizeRole(input)).toBe(ROLES.TEAM_MEMBER);
    },
  );

  it.each([[null], [undefined]])('defaults absent role %j to team_member', (input) => {
    expect(normalizeRole(input)).toBe(ROLES.TEAM_MEMBER);
  });

  it('never returns admin for any input outside the admin mappings', () => {
    const adminInputs = ['org:admin', 'admin', 'Admin', 'ADMIN'];
    const others = ['org:manager', 'org:member', 'staff', 'owner', '', 'ADMIN ', 'org:Admin'];

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
