import jwt from 'jsonwebtoken';
import type { AuthRequest } from '../../middleware/auth.middleware';
import { SubscriptionStatus } from '../../types/subscription';

const trackEvent = vi.fn();
let mockPrisma: any;
let mockIsAccessActive: jest.Mock;
const mockSubscriptionRepository = {
  findLatestByOrganizationId: vi.fn(),
};
const mockUserRepository = {
  findActiveByClerkUserId: vi.fn(),
};

// The SUT default-imports jsonwebtoken; expose `default` (Vitest, unlike jest,
// does not synthesize a default export from named exports).
vi.mock('jsonwebtoken', () => {
  const m = { verify: vi.fn(), sign: vi.fn() };
  return { ...m, default: m };
});

vi.mock('../../database/database-factory', () => ({
  getDefaultDatabaseClient: () => mockPrisma,
}));

vi.mock('../../di/container', () => ({
  getDiContainer: () => ({
    resolve: (token: unknown) => {
      const tokenName =
        typeof token === 'function' && 'name' in token ? (token as { name: string }).name : token;

      if (tokenName === 'SubscriptionRepository') {
        return mockSubscriptionRepository;
      }
      if (tokenName === 'UserRepository') {
        return mockUserRepository;
      }
      // 'Mock' is the name of a `vi.fn()` (jest's was 'mockConstructor'); the SUT
      // resolves the mocked SubscriptionService *class* (a vi.fn) by reference.
      if (
        tokenName === 'SubscriptionService' ||
        tokenName === 'mockConstructor' ||
        tokenName === 'Mock'
      ) {
        return { isAccessActive: (...args: any[]) => mockIsAccessActive(...args) };
      }

      throw new Error(`Unexpected DI token: ${String(tokenName)}`);
    },
  }),
}));

vi.mock('../../services/subscription.service', () => ({
  SubscriptionService: vi.fn().mockImplementation(function () {
    return {
      isAccessActive: (...args: any[]) => mockIsAccessActive(...args),
    };
  }),
}));

vi.mock('../../services/analytics.service', () => ({
  AnalyticsService: {
    getInstance: () => ({ trackEvent }),
  },
  AnalyticsEventType: {
    USER_LOGOUT: 'USER_LOGOUT',
    VIEW_DASHBOARD: 'VIEW_DASHBOARD',
  },
}));

vi.mock('../../middleware/clerk-auth.middleware', () => ({
  verifyClerkToken: vi.fn().mockResolvedValue(null),
  getAuthorizedParties: vi.fn().mockReturnValue(['localhost:3002']),
  clerkAuth: vi.fn(),
  clerkAuthOptional: vi.fn(),
}));

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn().mockResolvedValue(null),
}));

const { authenticateToken, requireManager } =
  (await import('../../middleware/auth.middleware')) as typeof import('../../middleware/auth.middleware');

const makeResponse = () => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  } as any;

  return res;
};

const makeRequest = (overrides?: Partial<AuthRequest>): AuthRequest =>
  ({
    headers: {},
    ip: '127.0.0.1',
    get: vi.fn((header: string) => (header === 'User-Agent' ? 'test-agent' : undefined)),
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
  const next = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.TEST_AUTH_BYPASS = 'false';
    process.env.JWT_SECRET = 'test_secret';
    delete process.env.JWT_SECRET_OLD;
    mockPrisma = {
      subscriptionTier: {
        findFirst: vi.fn(),
      },
    };
    mockIsAccessActive = vi.fn();
    mockSubscriptionRepository.findLatestByOrganizationId.mockReset();
    mockUserRepository.findActiveByClerkUserId.mockReset();
    // Ensure jwt.verify mock is available
    (jwt.verify as jest.Mock).mockReset();
  });

  describe('authenticateToken', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
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

      mockSubscriptionRepository.findLatestByOrganizationId.mockResolvedValue({
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

      mockSubscriptionRepository.findLatestByOrganizationId.mockResolvedValue({
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

      mockSubscriptionRepository.findLatestByOrganizationId.mockResolvedValue({
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

      mockSubscriptionRepository.findLatestByOrganizationId.mockResolvedValue({
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
