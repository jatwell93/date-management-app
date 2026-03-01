import jwt from 'jsonwebtoken';
import { authenticateToken, requireManager, AuthRequest } from '../../middleware/auth.middleware';
import { SubscriptionStatus } from '../../types/subscription';

const trackEvent = jest.fn();
let mockPrisma: any;
let mockIsAccessActive: jest.Mock;

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
  sign: jest.fn(),
}));

jest.mock('../../database/database-factory', () => ({
  getDefaultDatabaseClient: () => mockPrisma,
}));

jest.mock('../../services/subscription.service', () => ({
  SubscriptionService: jest.fn().mockImplementation(() => ({
    isAccessActive: (...args: any[]) => mockIsAccessActive(...args),
  })),
}));

jest.mock('../../services/analytics.service', () => ({
  AnalyticsService: {
    getInstance: () => ({ trackEvent }),
  },
  AnalyticsEventType: {
    USER_LOGOUT: 'USER_LOGOUT',
    VIEW_DASHBOARD: 'VIEW_DASHBOARD',
  },
}));

const makeResponse = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  } as any;

  return res;
};

const makeRequest = (overrides?: Partial<AuthRequest>): AuthRequest =>
  ({
    headers: {},
    ip: '127.0.0.1',
    get: jest.fn((header: string) => (header === 'User-Agent' ? 'test-agent' : undefined)),
    path: '/test',
    method: 'GET',
    ...overrides,
  }) as AuthRequest;

const testInvalidTokenScenario = async (
  errorMessage: string,
  nextFn: jest.Mock,
  expectTracking = true,
): Promise<void> => {
  const req = makeRequest({ headers: { authorization: 'Bearer invalid-token' } });
  const res = makeResponse();

  (jwt.verify as jest.Mock).mockImplementation(() => {
    throw new Error(errorMessage);
  });

  await authenticateToken(req, res, nextFn);

  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith({ message: 'Access denied: Invalid token' });
  if (expectTracking) {
    expect(trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventAction: 'invalid_token_attempt' }),
    );
  }
  expect(nextFn).not.toHaveBeenCalled();
};

describe('auth middleware', () => {
  const next = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.TEST_AUTH_BYPASS = 'false';
    process.env.JWT_SECRET = 'test_secret';
    delete process.env.JWT_SECRET_OLD;
    mockPrisma = {
      subscriptionTier: {
        findFirst: jest.fn(),
      },
    };
    mockIsAccessActive = jest.fn();
  });

  describe('authenticateToken', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('rejects when no token is provided', () => {
      const req = makeRequest();
      const res = makeResponse();

      authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: 'Access denied: No token provided' });
      expect(trackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventAction: 'unauthorized_access_attempt' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects invalid token when verification fails', async () => {
      await testInvalidTokenScenario('invalid', next);
    });

    it('rejects invalid token when rotation secret also fails', async () => {
      await testInvalidTokenScenario('invalid signature', next, false);
    });

    it('handles malformed token header gracefully', () => {
      const req = makeRequest({ headers: { authorization: 'invalid-format' } });
      const res = makeResponse();

      authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Access denied: No token provided',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects when decoded payload is invalid', async () => {
      const req = makeRequest({ headers: { authorization: 'Bearer token' } });
      const res = makeResponse();

      (jwt.verify as jest.Mock).mockReturnValue('not-a-payload');

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: 'Access denied: Invalid token payload' });
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects when token is expired', async () => {
      const req = makeRequest({ headers: { authorization: 'Bearer expired-token' } });
      const res = makeResponse();

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 1,
        role: 'Admin',
        organizationId: 'org-1',
        tierLevel: 'starter',
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
      });

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: 'Access denied: Token has expired' });
      expect(next).not.toHaveBeenCalled();
    });

    it('accepts valid token and sets user fields', async () => {
      const req = makeRequest({ headers: { authorization: 'Bearer token' } });
      const res = makeResponse();
      const updatedAt = new Date('2026-03-01T00:00:00.000Z');

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 7,
        role: 'Manager',
        organizationId: 'org-1',
        tierLevel: 'professional',
        exp: Math.floor(Date.now() / 1000) + 300,
      });

      (mockPrisma.subscriptionTier.findFirst as jest.Mock).mockResolvedValue({
        id: 1,
        organizationId: 'org-1',
        tierLevel: 'professional',
        status: SubscriptionStatus.ACTIVE,
        billingCycle: 'monthly',
        createdAt: new Date(),
        updatedAt,
      });

      mockIsAccessActive.mockResolvedValue(true);

      await authenticateToken(req, res, next);

      expect(req.userId).toBe(7);
      expect(req.userRole).toBe('Manager');
      expect(req.user).toEqual({
        id: 7,
        role: 'Manager',
        organizationId: 'org-1',
        tierLevel: 'professional',
      });
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Org-Tier-Version',
        `1:professional:${updatedAt.getTime()}`,
      );
      expect(trackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventAction: 'protected_route_access' }),
      );
      expect(next).toHaveBeenCalled();
    });

    it('logs stale token tier mismatches and enforces latest tier from DB', async () => {
      const req = makeRequest({ headers: { authorization: 'Bearer token' } });
      const res = makeResponse();
      const updatedAt = new Date('2026-03-02T00:00:00.000Z');

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 7,
        role: 'Manager',
        organizationId: 'org-stale-tier',
        tierLevel: 'premium',
        exp: Math.floor(Date.now() / 1000) + 300,
      });

      (mockPrisma.subscriptionTier.findFirst as jest.Mock).mockResolvedValue({
        id: 2,
        organizationId: 'org-stale-tier',
        tierLevel: 'starter',
        status: SubscriptionStatus.ACTIVE,
        billingCycle: 'monthly',
        createdAt: new Date(),
        updatedAt,
      });

      mockIsAccessActive.mockResolvedValue(true);

      await authenticateToken(req, res, next);

      expect(req.tierLevel).toBe('starter');
      expect(req.user?.tierLevel).toBe('starter');
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Org-Tier-Version',
        `2:starter:${updatedAt.getTime()}`,
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[AUTH] Stale token tier detected; using latest DB tier',
        expect.objectContaining({ tokenTierLevel: 'premium', dbTierLevel: 'starter' }),
      );
      expect(next).toHaveBeenCalled();
    });

    it('allows access when subscription is canceled but Stripe still active', async () => {
      const req = makeRequest({ headers: { authorization: 'Bearer token' } });
      const res = makeResponse();

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 7,
        role: 'Manager',
        organizationId: 'org-1',
        tierLevel: 'professional',
        exp: Math.floor(Date.now() / 1000) + 300,
      });

      (mockPrisma.subscriptionTier.findFirst as jest.Mock).mockResolvedValue({
        id: 1,
        organizationId: 'org-1',
        tierLevel: 'professional',
        status: SubscriptionStatus.CANCELED,
        billingCycle: 'monthly',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockIsAccessActive.mockResolvedValue(true);

      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalledWith(403);
    });

    it('rejects access when subscription is canceled and period ended', async () => {
      const req = makeRequest({ headers: { authorization: 'Bearer token' } });
      const res = makeResponse();

      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 7,
        role: 'Manager',
        organizationId: 'org-1',
        tierLevel: 'professional',
        exp: Math.floor(Date.now() / 1000) + 300,
      });

      (mockPrisma.subscriptionTier.findFirst as jest.Mock).mockResolvedValue({
        id: 1,
        organizationId: 'org-1',
        tierLevel: 'professional',
        status: SubscriptionStatus.CANCELED,
        billingCycle: 'monthly',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Clear the cache module state or use a different org ID to avoid cache hits
      req.user = undefined;
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 7,
        role: 'Manager',
        organizationId: 'org-uncached',
        tierLevel: 'professional',
        exp: Math.floor(Date.now() / 1000) + 300,
      });

      mockIsAccessActive.mockResolvedValue(false);

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Organization subscription has been canceled. Please contact support.',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('requireManager', () => {
    it('rejects non-manager roles', () => {
      const req = makeRequest({ userId: 1, userRole: 'Staff' });
      const res = makeResponse();

      requireManager(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ message: 'Access denied: Manager role required' });
      expect(trackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventAction: 'manager_access_denied' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('allows manager role', () => {
      const req = makeRequest({ userId: 1, userRole: 'Manager' });
      const res = makeResponse();

      requireManager(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('allows admin role', () => {
      const req = makeRequest({ userId: 1, userRole: 'admin' });
      const res = makeResponse();

      requireManager(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
