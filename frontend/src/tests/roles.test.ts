import {
  ROLES,
  ROLE_LABELS,
  PERMISSIONS,
  PRODUCTION_ROLES,
  isValidRole,
  hasPermission,
  normalizeRole,
} from '../constants/roles';

describe('Frontend role constants', () => {
  describe('ROLES', () => {
    it('defines admin, manager, team_member', () => {
      expect(ROLES.ADMIN).toBe('admin');
      expect(ROLES.MANAGER).toBe('manager');
      expect(ROLES.TEAM_MEMBER).toBe('team_member');
    });
  });

  describe('ROLE_LABELS', () => {
    it('maps canonical roles to human-readable labels', () => {
      expect(ROLE_LABELS[ROLES.ADMIN]).toBe('Admin');
      expect(ROLE_LABELS[ROLES.MANAGER]).toBe('Manager');
      expect(ROLE_LABELS[ROLES.TEAM_MEMBER]).toBe('Team Member');
    });
  });

  describe('PRODUCTION_ROLES', () => {
    it('includes only admin and team_member (no manager in prod)', () => {
      expect(PRODUCTION_ROLES).toContain(ROLES.ADMIN);
      expect(PRODUCTION_ROLES).toContain(ROLES.TEAM_MEMBER);
      expect(PRODUCTION_ROLES).not.toContain(ROLES.MANAGER);
    });
  });

  describe('isValidRole', () => {
    it('returns true for canonical roles', () => {
      expect(isValidRole('admin')).toBe(true);
      expect(isValidRole('manager')).toBe(true);
      expect(isValidRole('team_member')).toBe(true);
    });

    it('returns false for legacy/invalid strings', () => {
      expect(isValidRole('Manager')).toBe(false);
      expect(isValidRole('owner')).toBe(false);
      expect(isValidRole('Staff')).toBe(false);
      expect(isValidRole('')).toBe(false);
    });
  });

  describe('normalizeRole', () => {
    it('returns canonical role for valid input', () => {
      expect(normalizeRole('admin')).toBe('admin');
      expect(normalizeRole('team_member')).toBe('team_member');
    });

    it('maps legacy strings to canonical roles', () => {
      expect(normalizeRole('Manager')).toBe('manager');
      expect(normalizeRole('owner')).toBe('admin');
      expect(normalizeRole('Staff')).toBe('team_member');
      expect(normalizeRole('Team Member')).toBe('team_member');
      expect(normalizeRole('ADMIN')).toBe('admin');
    });

    it('maps Clerk org_role prefixed values to canonical roles', () => {
      expect(normalizeRole('org:admin')).toBe('admin');
      expect(normalizeRole('org:manager')).toBe('manager');
      expect(normalizeRole('org:member')).toBe('team_member');
      expect(normalizeRole('org:team_member')).toBe('team_member');
    });

    it('defaults to team_member for null/undefined/unknown', () => {
      expect(normalizeRole(null)).toBe('team_member');
      expect(normalizeRole(undefined)).toBe('team_member');
      expect(normalizeRole('garbage')).toBe('team_member');
    });
  });

  describe('hasPermission', () => {
    it('admin has all permissions', () => {
      expect(hasPermission('admin', PERMISSIONS.MANAGE_MEMBERS)).toBe(true);
      expect(hasPermission('admin', PERMISSIONS.UPLOAD_FILES)).toBe(true);
      expect(hasPermission('admin', PERMISSIONS.READ_ONLY)).toBe(true);
    });

    it('manager has manage_members and upload_files', () => {
      expect(hasPermission('manager', PERMISSIONS.MANAGE_MEMBERS)).toBe(true);
      expect(hasPermission('manager', PERMISSIONS.UPLOAD_FILES)).toBe(true);
      expect(hasPermission('manager', PERMISSIONS.READ_ONLY)).toBe(true);
    });

    it('team_member only has read_only', () => {
      expect(hasPermission('team_member', PERMISSIONS.MANAGE_MEMBERS)).toBe(false);
      expect(hasPermission('team_member', PERMISSIONS.UPLOAD_FILES)).toBe(false);
      expect(hasPermission('team_member', PERMISSIONS.READ_ONLY)).toBe(true);
    });
  });
});
