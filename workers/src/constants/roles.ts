/**
 * Canonical organization role constants — Workers re-export.
 *
 * Keep in sync with backend/src/constants/roles.ts.
 * Only the subset needed by Workers authorization is included here.
 */

export const ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  TEAM_MEMBER: 'team_member',
} as const;

export type RoleValue = (typeof ROLES)[keyof typeof ROLES];

export const PERMISSIONS = {
  UPLOAD_FILES: 'upload_files',
  READ_ONLY: 'read_only',
} as const;

export type PermissionValue = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Roles that are allowed to upload files. */
export const UPLOAD_ALLOWED_ROLES: readonly RoleValue[] = [ROLES.ADMIN, ROLES.MANAGER];

/**
 * Maps Clerk membership role strings to canonical role values.
 * Used when extracting org_role from JWT claims.
 */
export const CLERK_ROLE_MAP: Record<string, RoleValue> = {
  'org:admin': ROLES.ADMIN,
  admin: ROLES.ADMIN,
  Admin: ROLES.ADMIN,
  ADMIN: ROLES.ADMIN,
  'org:manager': ROLES.MANAGER,
  manager: ROLES.MANAGER,
  Manager: ROLES.MANAGER,
  MANAGER: ROLES.MANAGER,
  'org:member': ROLES.TEAM_MEMBER,
  'org:team_member': ROLES.TEAM_MEMBER,
  team_member: ROLES.TEAM_MEMBER,
  Team_Member: ROLES.TEAM_MEMBER,
  TEAM_MEMBER: ROLES.TEAM_MEMBER,
  'team-member': ROLES.TEAM_MEMBER,
  'Team Member': ROLES.TEAM_MEMBER,
  member: ROLES.TEAM_MEMBER,
  Staff: ROLES.TEAM_MEMBER,
  staff: ROLES.TEAM_MEMBER,
};

/** Normalize any role string to a canonical RoleValue. Defaults to team_member. */
export function normalizeRole(role: string | null | undefined): RoleValue {
  if (!role) return ROLES.TEAM_MEMBER;
  return CLERK_ROLE_MAP[role] ?? ROLES.TEAM_MEMBER;
}

/** Check if the role is allowed to upload files. */
export function canUpload(role: RoleValue): boolean {
  return UPLOAD_ALLOWED_ROLES.includes(role);
}
