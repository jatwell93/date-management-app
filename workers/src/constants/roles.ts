/**
 * Worker-side role constants.
 *
 * The vocabulary and the normalizer are **re-exported from
 * `shared/domain/roles.ts`**, not restated here. This file used to carry its own
 * copy under the instruction "Keep in sync with backend/src/constants/roles.ts",
 * and it was not in sync — the copy omitted `owner`, so the same Clerk role
 * normalized to `admin` through the bootstrap path and to `team_member` here.
 * Issue #517 is what that class of drift costs.
 *
 * What remains below is genuinely Worker-specific: the upload permission.
 */
export {
  ROLES,
  CANONICAL_ROLES,
  ROLE_ALIASES,
  normalizeRole,
  isCanonicalRole,
} from '../../../shared/domain/roles';
export type { RoleValue } from '../../../shared/domain/roles';

import { ROLES, type RoleValue } from '../../../shared/domain/roles';

/**
 * Retained alias for the shared table. Named for Clerk because that is this
 * Worker's only ingress, but the table also covers the Express-era database
 * spellings — see `shared/domain/roles.ts`.
 */
export { ROLE_ALIASES as CLERK_ROLE_MAP } from '../../../shared/domain/roles';

export const PERMISSIONS = {
  UPLOAD_FILES: 'upload_files',
  READ_ONLY: 'read_only',
} as const;

export type PermissionValue = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Roles that are allowed to upload files. */
export const UPLOAD_ALLOWED_ROLES: readonly RoleValue[] = [ROLES.ADMIN, ROLES.MANAGER];

/** Check if the role is allowed to upload files. */
export function canUpload(role: RoleValue): boolean {
  return UPLOAD_ALLOWED_ROLES.includes(role);
}
