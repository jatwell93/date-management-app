const makeResponse = () =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  }) as any;

const makeRequest = () =>
  ({
    headers: { authorization: 'Bearer clerk-token' },
    ip: '127.0.0.1',
    get: jest.fn((header: string) => (header === 'User-Agent' ? 'test-agent' : undefined)),
    path: '/test',
    method: 'GET',
  }) as any;

describe('auth middleware DI boundary', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.TEST_AUTH_BYPASS = 'false';
  });

  it('resolves Clerk-token users and subscriptions through repositories without using the database factory', async () => {
    const mockGetDefaultDatabaseClient = jest.fn(() => ({
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 12,
          role: 'Manager',
          organizationId: 'org-clerk',
        }),
      },
      subscriptionTier: {
        findFirst: jest.fn().mockResolvedValue({
          id: 3,
          organizationId: 'org-clerk',
          tierLevel: 'professional',
          status: 'active',
          billingCycle: 'monthly',
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
          updatedAt: new Date('2026-03-01T00:00:00.000Z'),
        }),
      },
    }));
    const mockUserRepository = {
      findActiveByClerkUserId: jest.fn().mockResolvedValue({
        id: 12,
        role: 'Manager',
        organizationId: 'org-clerk',
      }),
    };
    const mockSubscriptionRepository = {
      findLatestByOrganizationId: jest.fn().mockResolvedValue({
        id: 3,
        organizationId: 'org-clerk',
        tierLevel: 'professional',
        status: 'active',
        billingCycle: 'monthly',
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      }),
    };

    jest.doMock('jsonwebtoken', () => ({
      verify: jest.fn(() => {
        throw new Error('invalid local token');
      }),
      sign: jest.fn(),
    }));
    jest.doMock('@clerk/backend', () => ({
      verifyToken: jest.fn().mockResolvedValue({
        sub: 'clerk-user-1',
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
    }));
    jest.doMock('../../config/environment', () => ({
      envConfig: {
        JWT_SECRET: 'test_secret',
        CLERK_SECRET_KEY: 'clerk_secret',
        FRONTEND_URL: 'http://localhost:3002',
        CORS_ORIGIN: '',
      },
    }));
    jest.doMock('../../database/database-factory', () => ({
      getDefaultDatabaseClient: () => mockGetDefaultDatabaseClient(),
    }));
    jest.doMock('../../services/analytics.service', () => ({
      AnalyticsService: {
        getInstance: () => ({ trackEvent: jest.fn() }),
      },
      AnalyticsEventType: {
        USER_LOGOUT: 'USER_LOGOUT',
        VIEW_DASHBOARD: 'VIEW_DASHBOARD',
      },
    }));
    jest.doMock('../../services/subscription.service', () => ({
      SubscriptionService: class MockSubscriptionService {
        isAccessActive = jest.fn().mockResolvedValue(true);
      },
    }));
    jest.doMock('../../repositories/user.repository', () => ({
      UserRepository: class UserRepository {},
    }));
    jest.doMock('../../repositories/subscription.repository', () => ({
      SubscriptionRepository: class SubscriptionRepository {},
    }));
    jest.doMock('../../di/container', () => ({
      getDiContainer: () => ({
        resolve: (token: unknown) => {
          const tokenName =
            typeof token === 'function' && 'name' in token
              ? (token as { name: string }).name
              : token;

          if (tokenName === 'UserRepository') {
            return mockUserRepository;
          }
          if (tokenName === 'SubscriptionRepository') {
            return mockSubscriptionRepository;
          }

          throw new Error(`Unexpected DI token: ${String(tokenName)}`);
        },
      }),
    }));

    const { authenticateToken } =
      require('../../middleware/auth.middleware') as typeof import('../../middleware/auth.middleware');
    const req = makeRequest();
    const res = makeResponse();
    const next = jest.fn();

    await authenticateToken(req, res, next);

    expect(mockUserRepository.findActiveByClerkUserId).toHaveBeenCalledWith('clerk-user-1');
    expect(mockSubscriptionRepository.findLatestByOrganizationId).toHaveBeenCalledWith('org-clerk');
    expect(mockGetDefaultDatabaseClient).not.toHaveBeenCalled();
    expect(req.user).toEqual({
      id: 12,
      role: 'Manager',
      organizationId: 'org-clerk',
      tierLevel: 'professional',
    });
    expect(next).toHaveBeenCalled();
  });
});
