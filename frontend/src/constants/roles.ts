/**
 * Canonical organization role constants — frontend re-export.
 *
 * Keep in sync with backend/src/constants/roles.ts.
 * Only the subset needed by UI logic is included here.
 */

export const ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  TEAM_MEMBER: 'team_member',
} as const;

export type RoleValue = (typeof ROLES)[keyof typeof ROLES];

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

/** Type guard: is the string a valid canonical role? */
export function isValidRole(role: string): role is RoleValue {
  return (Object.values(ROLES) as string[]).includes(role);
}

/** Production-only roles (excludes manager until plan upgrade). */
export const PRODUCTION_ROLES: readonly RoleValue[] = [ROLES.ADMIN, ROLES.TEAM_MEMBER];

const LEGACY_ROLE_MAP: Record<string, RoleValue> = {
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

/** Normalize any role string (legacy or canonical) to a canonical RoleValue. */
export function normalizeRole(role: string | null | undefined): RoleValue {
  if (!role) return ROLES.TEAM_MEMBER;
  if (isValidRole(role)) return role;
  return LEGACY_ROLE_MAP[role] ?? ROLES.TEAM_MEMBER;
}
