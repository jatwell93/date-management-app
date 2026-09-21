/**
 * Organization role permissions for Express.
 *
 * The **vocabulary and the normalizer now live in `shared/domain/roles.ts`** and
 * are re-exported here so existing importers are unchanged. They were moved
 * because three files carried a copy under the instruction "keep in sync" and
 * the copies had drifted — see that module and issue #517.
 *
 * Production Clerk plan supports: admin, team_member
 * Dev Clerk also has: manager (optional, not available in production until plan upgrade)
 *
 * All internal logic MUST use these constants — never raw strings.
 * External inputs (Clerk membership roles, legacy DB values) are normalized
 * at the ingress boundary via `normalizeRole()`.
 */
import { ROLES, type RoleValue } from '../../../shared/domain/roles';

export {
  ROLES,
  CANONICAL_ROLES,
  normalizeRole,
  isCanonicalRole,
} from '../../../shared/domain/roles';
export type { RoleValue } from '../../../shared/domain/roles';

/** Historical name for the shared alias table. */
export { ROLE_ALIASES as LEGACY_ROLE_MAP } from '../../../shared/domain/roles';

/** Numeric hierarchy for comparison (higher = more privilege). */
export const ROLE_HIERARCHY: Record<RoleValue, number> = {
  [ROLES.ADMIN]: 3,
  [ROLES.MANAGER]: 2,
  [ROLES.TEAM_MEMBER]: 1,
};

export const PERMISSIONS = {
  MANAGE_ORGANIZATION: 'manage_organization',
  MANAGE_MEMBERS: 'manage_members',
  MANAGE_INVITES: 'manage_invites',
  UPLOAD_FILES: 'upload_files',
  VIEW_AUDIT_LOGS: 'view_audit_logs',
  READ_ONLY: 'read_only',
} as const;

export type PermissionValue = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Permission matrix:
 *   admin       = full control (org delete, ownership transfer, member/invite/upload management)
 *   manager     = member/invite/upload management but no org delete (optional until plan upgrade)
 *   team_member = read-only operations
 */
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

/** Org audit event types for the OrgAuditLog table. */
export const AUDIT_EVENT_TYPES = {
  INVITE_CREATED: 'invite_created',
  INVITE_ACCEPTED: 'invite_accepted',
  INVITE_REVOKED: 'invite_revoked',
  INVITE_RESENT: 'invite_resent',
  ROLE_ASSIGNED: 'role_assigned',
  ROLE_REMOVED: 'role_removed',
} as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[keyof typeof AUDIT_EVENT_TYPES];

/** Type guard: is the string a valid canonical role? Alias for `isCanonicalRole`. */
export { isCanonicalRole as isValidRole } from '../../../shared/domain/roles';

/** Check if a given role has a specific permission. */
export function hasPermission(role: RoleValue, permission: PermissionValue): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** Check if roleA has equal or higher privilege than roleB. */
export function hasEqualOrHigherRole(roleA: RoleValue, roleB: RoleValue): boolean {
  return (ROLE_HIERARCHY[roleA] ?? 0) >= (ROLE_HIERARCHY[roleB] ?? 0);
}

/** All canonical role values as an array (useful for validation). */
export const ALL_ROLES: readonly RoleValue[] = Object.values(ROLES);

/** Production-only roles (excludes manager). */
export const PRODUCTION_ROLES: readonly RoleValue[] = [ROLES.ADMIN, ROLES.TEAM_MEMBER];
