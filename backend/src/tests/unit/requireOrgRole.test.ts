import { Request, Response, NextFunction } from 'express';
import { requireOrgRole, requirePermission, requireMinRole } from '../../middleware/requireOrgRole';
import { ROLES } from '../../constants/roles';

// Minimal mock of AnalyticsService to prevent singleton issues
vi.mock('../../services/analytics.service', () => ({
  AnalyticsService: {
    getInstance: () => ({
      trackEvent: vi.fn(),
    }),
    resetInstance: vi.fn(),
  },
  AnalyticsEventType: { USER_LOGOUT: 'user_logout' },
}));

function createMockReqRes(role: string | undefined) {
  const req = {
    userRole: role,
    user: role ? { role } : undefined,
    userId: 1,
    ip: '127.0.0.1',
    path: '/test',
    method: 'GET',
    get: vi.fn().mockReturnValue('test-agent'),
  } as unknown as Request & { userRole?: string; user?: { role: string } };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  const next = vi.fn() as NextFunction;

  return { req, res, next };
}

describe('requireOrgRole middleware', () => {
  describe('admin-only routes', () => {
    const middleware = requireOrgRole(ROLES.ADMIN);

    it('allows admin', () => {
      const { req, res, next } = createMockReqRes('admin');
      middleware(req as any, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('blocks manager', () => {
      const { req, res, next } = createMockReqRes('manager');
      middleware(req as any, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('blocks team_member', () => {
      const { req, res, next } = createMockReqRes('team_member');
      middleware(req as any, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('blocks missing role', () => {
      const { req, res, next } = createMockReqRes(undefined);
      middleware(req as any, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('admin+manager routes', () => {
    const middleware = requireOrgRole(ROLES.ADMIN, ROLES.MANAGER);

    it('allows admin', () => {
      const { req, res, next } = createMockReqRes('admin');
      middleware(req as any, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('allows manager', () => {
      const { req, res, next } = createMockReqRes('manager');
      middleware(req as any, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('blocks team_member', () => {
      const { req, res, next } = createMockReqRes('team_member');
      middleware(req as any, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('legacy role normalization', () => {
    const middleware = requireOrgRole(ROLES.ADMIN);

    it('normalizes legacy "Manager" to manager and blocks admin-only route', () => {
      const { req, res, next } = createMockReqRes('Manager');
      middleware(req as any, res, next);
      // Manager normalizes to 'manager', not 'admin', so should be blocked
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('normalizes legacy "owner" to admin', () => {
      const { req, res, next } = createMockReqRes('owner');
      middleware(req as any, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('normalizes legacy "Staff" to team_member', () => {
      const { req, res, next } = createMockReqRes('Staff');
      middleware(req as any, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('role patching on request', () => {
    it('patches req.userRole with canonical value', () => {
      const middleware = requireOrgRole(ROLES.ADMIN);
      const { req, res, next } = createMockReqRes('owner');
      middleware(req as any, res, next);
      expect((req as any).userRole).toBe('admin');
    });
  });
});

describe('requirePermission middleware', () => {
  it('allows admin for upload_files permission', () => {
    const middleware = requirePermission('upload_files');
    const { req, res, next } = createMockReqRes('admin');
    middleware(req as any, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows manager for upload_files permission', () => {
    const middleware = requirePermission('upload_files');
    const { req, res, next } = createMockReqRes('manager');
    middleware(req as any, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('blocks team_member for upload_files permission', () => {
    const middleware = requirePermission('upload_files');
    const { req, res, next } = createMockReqRes('team_member');
    middleware(req as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows all roles for read_only permission', () => {
    const middleware = requirePermission('read_only');
    for (const role of ['admin', 'manager', 'team_member']) {
      const { req, res, next } = createMockReqRes(role);
      middleware(req as any, res, next);
      expect(next).toHaveBeenCalled();
    }
  });
});

describe('requireMinRole middleware', () => {
  it('admin meets minimum of team_member', () => {
    const middleware = requireMinRole(ROLES.TEAM_MEMBER);
    const { req, res, next } = createMockReqRes('admin');
    middleware(req as any, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('manager meets minimum of manager', () => {
    const middleware = requireMinRole(ROLES.MANAGER);
    const { req, res, next } = createMockReqRes('manager');
    middleware(req as any, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('team_member does NOT meet minimum of manager', () => {
    const middleware = requireMinRole(ROLES.MANAGER);
    const { req, res, next } = createMockReqRes('team_member');
    middleware(req as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('team_member does NOT meet minimum of admin', () => {
    const middleware = requireMinRole(ROLES.ADMIN);
    const { req, res, next } = createMockReqRes('team_member');
    middleware(req as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
