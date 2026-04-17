/**
 * Canonical organization role constants and permission matrix.
 *
 * Production Clerk plan supports: admin, team_member
 * Dev Clerk also has: manager (optional, not available in production until plan upgrade)
 *
 * All internal logic MUST use these constants — never raw strings.
 * External inputs (Clerk membership roles, legacy DB values) are normalized
 * at the ingress boundary via `normalizeRole()`.
 */

export const ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  TEAM_MEMBER: 'team_member',
} as const;

export type RoleValue = (typeof ROLES)[keyof typeof ROLES];

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

/**
 * Maps legacy / external role strings to canonical enum values.
 * Used at ingress boundaries: Clerk webhook payloads, token decoding, backfill scripts.
 */
export const LEGACY_ROLE_MAP: Record<string, RoleValue> = {
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
 * Normalize any role string to a canonical RoleValue.
 * Unknown / null values default to team_member (least privilege).
 */
export function normalizeRole(role: string | null | undefined): RoleValue {
  if (!role) return ROLES.TEAM_MEMBER;
  return LEGACY_ROLE_MAP[role] ?? ROLES.TEAM_MEMBER;
}

/** Type guard: is the string a valid canonical role? */
export function isValidRole(role: string): role is RoleValue {
  return (Object.values(ROLES) as string[]).includes(role);
}

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
