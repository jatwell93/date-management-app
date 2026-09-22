/**
 * Frontend role constants.
 *
 * The vocabulary and the normalizer are **re-exported from
 * `shared/domain/roles.ts`** rather than restated. This file used to carry its
 * own copy under the instruction "Keep in sync with
 * backend/src/constants/roles.ts" — the same instruction the other copy carried
 * while silently disagreeing with it, which is issue #517.
 *
 * This copy happened to agree entry-for-entry, but nothing enforced that, and
 * it is not decorative: `ClerkAuthProvider.tsx:17` normalizes the JWT
 * `role`/`org_role` claim through `normalizeRole`, and the UI permission gates
 * act on the result. An alias added to the shared table alone would have made
 * the client's gates disagree with the server's for the same user — #517,
 * client-side.
 *
 * What stays here is genuinely frontend-specific: the permission matrix and
 * the display labels.
 */
export { ROLES, CANONICAL_ROLES, normalizeRole, isCanonicalRole } from '@shared/roles';
export type { RoleValue } from '@shared/roles';

import { ROLES, type RoleValue } from '@shared/roles';

export const PERMISSIONS = {
  MANAGE_ORGANIZATION: 'manage_organization',
  MANAGE_MEMBERS: 'manage_members',
  MANAGE_INVITES: 'manage_invites',
  UPLOAD_FILES: 'upload_files',
  VIEW_AUDIT_LOGS: 'view_audit_logs',
  READ_ONLY: 'read_only',
} as const;

export type PermissionValue = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_PERMISSIONS: Record<RoleValue, readonly PermissionValue[]> = {
  [ROLES.ADMIN]: [
    PERMISSIONS.MANAGE_ORGANIZATION,
    PERMISSIONS.MANAGE_MEMBERS,
    PERMISSIONS.MANAGE_INVITES,
    PERMISSIONS.UPLOAD_FILES,
    PERMISSIONS.VIEW_AUDIT_LOGS,
    PERMISSIONS.READ_ONLY,
  ],
  [ROLES.MANAGER]: [
    PERMISSIONS.MANAGE_MEMBERS,
    PERMISSIONS.MANAGE_INVITES,
    PERMISSIONS.UPLOAD_FILES,
    PERMISSIONS.VIEW_AUDIT_LOGS,
    PERMISSIONS.READ_ONLY,
  ],
  [ROLES.TEAM_MEMBER]: [PERMISSIONS.READ_ONLY],
};

/** UI-friendly display labels for roles. */
export const ROLE_LABELS: Record<RoleValue, string> = {
  [ROLES.ADMIN]: 'Admin',
  [ROLES.MANAGER]: 'Manager',
  [ROLES.TEAM_MEMBER]: 'Team Member',
};

/** Check if a given role has a specific permission. */
export function hasPermission(role: RoleValue, permission: PermissionValue): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** Production-only roles (excludes manager until plan upgrade). */
export const PRODUCTION_ROLES: readonly RoleValue[] = [ROLES.ADMIN, ROLES.TEAM_MEMBER];

/** Type guard: is the string a valid canonical role? Alias for `isCanonicalRole`. */
export { isCanonicalRole as isValidRole } from '@shared/roles';
