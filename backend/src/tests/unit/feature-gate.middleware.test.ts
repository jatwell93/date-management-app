import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  requireFeature,
  checkUsageLimit,
  checkFeature,
  FeatureKey,
  LimitKey,
} from '../../middleware/feature-gate.middleware';
import { AuthRequest } from '../../middleware/auth.middleware';
import { getDefaultDatabaseClient } from '../../database/database-factory';

jest.mock('../../database/database-factory');

// Mock Logger
jest.mock('../../utils/logger', () => ({
  Logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock AnalyticsService
jest.mock('../../services/analytics.service', () => ({
  AnalyticsService: {
    getInstance: jest.fn().mockReturnValue({
      trackEvent: jest.fn(),
    }),
  },
  AnalyticsEventType: {
    USER_LOGOUT: 'USER_LOGOUT',
    FEATURE_ACCESS_DENIED: 'FEATURE_ACCESS_DENIED',
    USAGE_LIMIT_EXCEEDED: 'USAGE_LIMIT_EXCEEDED',
    CROSS_TENANT_ACCESS_ATTEMPT: 'CROSS_TENANT_ACCESS_ATTEMPT',
  },
}));

describe('Feature Gating Middleware', () => {
  let req: Partial<AuthRequest>;
  let res: Partial<Response>;
  let next: jest.Mock;
  let prisma: Partial<PrismaClient>;

  beforeEach(() => {
    req = {
      userId: 1,
      organizationId: 'org-1',
      tierLevel: 'professional',
      ip: '127.0.0.1',
      get: jest.fn((name: string) => (name === 'set-cookie' ? undefined : ['Mozilla/5.0'])) as any,
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      locals: {},
    };

    next = jest.fn();

    prisma = {
      tierFeatureFlag: {
        findUnique: jest.fn(),
      },
      organizationUsage: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      subscriptionTier: {
        findFirst: jest.fn(),
      },
    } as any;

    (getDefaultDatabaseClient as jest.Mock).mockReturnValue(prisma);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('requireFeature middleware (Task 5.1-5.3)', () => {
    it('allows access when feature is enabled for tier (Task 5.2)', async () => {
      (prisma.tierFeatureFlag!.findUnique as jest.Mock).mockResolvedValue({
        tierLevel: 'professional',
        featureKey: 'advanced_analytics',
        enabled: true,
        limitValue: null,
      });

      const middleware = requireFeature('advanced_analytics');
      await middleware(req as AuthRequest, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('denies access with 403 when feature not enabled for Starter tier (Task 5.3)', async () => {
      req.tierLevel = 'starter';

      (prisma.tierFeatureFlag!.findUnique as jest.Mock).mockResolvedValue({
        tierLevel: 'starter',
        featureKey: 'advanced_analytics',
        enabled: false,
        limitValue: null,
      });

      const middleware = requireFeature('advanced_analytics');
      await middleware(req as AuthRequest, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('not available'),
          feature: 'advanced_analytics',
          currentTier: 'starter',
          upgradeCTA: expect.any(String),
          upgradeUrl: expect.any(String),
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('allows advanced_analytics for premium tier', async () => {
      req.tierLevel = 'premium';

      (prisma.tierFeatureFlag!.findUnique as jest.Mock).mockResolvedValue({
        tierLevel: 'premium',
        featureKey: 'advanced_analytics',
        enabled: true,
        limitValue: null,
      });

      const middleware = requireFeature('advanced_analytics');
      await middleware(req as AuthRequest, res as Response, next);

      expect(next).toHaveBeenCalled();
    });

    it('allows api_access for professional tier and above (Task 5.1)', async () => {
      (prisma.tierFeatureFlag!.findUnique as jest.Mock).mockResolvedValue({
        tierLevel: 'professional',
        featureKey: 'api_access',
        enabled: true,
        limitValue: null,
      });

      const middleware = requireFeature('api_access');
      await middleware(req as AuthRequest, res as Response, next);

      expect(next).toHaveBeenCalled();
    });

    it('returns 403 when tier_feature_flag record not found', async () => {
      (prisma.tierFeatureFlag!.findUnique as jest.Mock).mockResolvedValue(null);

      const middleware = requireFeature('unknown_feature' as FeatureKey);
      await middleware(req as AuthRequest, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 when organizationId missing from request', async () => {
      req.organizationId = '';

      const middleware = requireFeature('advanced_analytics');
      await middleware(req as AuthRequest, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Missing tenant context'),
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('handles database errors gracefully', async () => {
      (prisma.tierFeatureFlag!.findUnique as jest.Mock).mockRejectedValue(
        new Error('Database error'),
      );

      const middleware = requireFeature('advanced_analytics');
      await middleware(req as AuthRequest, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('not available'),
        }),
      );
    });
  });

  describe('checkUsageLimit middleware (Task 5.4-5.6)', () => {
    it('allows request when under SKU limit', async () => {
      const limitKey: LimitKey = 'max_skus';

      (prisma.organizationUsage!.findUnique as jest.Mock).mockResolvedValue({
        organizationId: 'org-1',
        activeUsers: 1,
        maxUsers: 3,
        totalSkus: 100,
        maxSkus: 500,
        storageUsedBytes: 0,
      });

      const middleware = checkUsageLimit(limitKey);
      await middleware(req as AuthRequest, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('denies request with 403 when SKU limit exceeded (Task 5.6)', async () => {
      const limitKey: LimitKey = 'max_skus';

      (prisma.organizationUsage!.findUnique as jest.Mock).mockResolvedValue({
        organizationId: 'org-1',
        activeUsers: 1,
        maxUsers: 3,
        totalSkus: 500, // At limit
        maxSkus: 500,
        storageUsedBytes: 0,
      });

      const middleware = checkUsageLimit(limitKey);
      await middleware(req as AuthRequest, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Usage limit reached'),
          limitKey: 'max_skus',
          currentUsage: 500,
          limit: 500,
          percentageUsed: 100,
          upgradeCTA: expect.any(String),
          upgradeUrl: expect.any(String),
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('allows request when user limit under maximum', async () => {
      const limitKey: LimitKey = 'max_users';

      (prisma.organizationUsage!.findUnique as jest.Mock).mockResolvedValue({
        organizationId: 'org-1',
        activeUsers: 2,
        maxUsers: 3,
        totalSkus: 100,
        maxSkus: 500,
        storageUsedBytes: 0,
      });

      const middleware = checkUsageLimit(limitKey);
      await middleware(req as AuthRequest, res as Response, next);

      expect(next).toHaveBeenCalled();
    });

    it('denies request when user limit exceeded (Task 5.5)', async () => {
      const limitKey: LimitKey = 'max_users';

      (prisma.organizationUsage!.findUnique as jest.Mock).mockResolvedValue({
        organizationId: 'org-1',
        activeUsers: 3, // At limit
        maxUsers: 3,
        totalSkus: 100,
        maxSkus: 500,
        storageUsedBytes: 0,
      });

      const middleware = checkUsageLimit(limitKey);
      await middleware(req as AuthRequest, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Usage limit reached'),
          limitKey: 'max_users',
        }),
      );
    });

    it('attaches warning to response when at 80% usage', async () => {
      const limitKey: LimitKey = 'max_skus';

      (prisma.organizationUsage!.findUnique as jest.Mock).mockResolvedValue({
        organizationId: 'org-1',
        activeUsers: 1,
        maxUsers: 3,
        totalSkus: 400, // 80% of 500
        maxSkus: 500,
        storageUsedBytes: 0,
      });

      const middleware = checkUsageLimit(limitKey);
      await middleware(req as AuthRequest, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(res.locals!.usageWarning).toEqual(
        expect.objectContaining({
          limitKey: 'max_skus',
          currentUsage: 400,
          limit: 500,
          percentageUsed: 80,
          message: expect.stringContaining('80'),
        }),
      );
    });

    it('creates organization_usage record if not found', async () => {
      const limitKey: LimitKey = 'max_skus';

      (prisma.organizationUsage!.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.organizationUsage!.create as jest.Mock).mockResolvedValue({
        organizationId: 'org-1',
        activeUsers: 0,
        maxUsers: 1,
        totalSkus: 0,
        maxSkus: 500,
        storageUsedBytes: 0,
      });

      const middleware = checkUsageLimit(limitKey);
      await middleware(req as AuthRequest, res as Response, next);

      expect(prisma.organizationUsage!.create).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('returns 403 when organizationId missing from request (Task 5.4)', async () => {
      req.organizationId = '';

      const middleware = checkUsageLimit('max_skus');
      await middleware(req as AuthRequest, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Missing organization context'),
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('handles database errors gracefully', async () => {
      (prisma.organizationUsage!.findUnique as jest.Mock).mockRejectedValue(
        new Error('Database error'),
      );

      const middleware = checkUsageLimit('max_skus');
      await middleware(req as AuthRequest, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Error checking usage limit',
        }),
      );
    });
  });

  describe('checkFeature helper function (Task 5.7)', () => {
    it('returns feature check result for enabled feature', async () => {
      (prisma.tierFeatureFlag!.findUnique as jest.Mock).mockResolvedValue({
        tierLevel: 'professional',
        featureKey: 'api_access',
        enabled: true,
        limitValue: null,
      });

      const result = await checkFeature('professional', 'api_access');

      expect(result).toEqual({
        isEnabled: true,
        limitValue: undefined,
        tier: 'professional',
      });
    });

    it('returns feature check result for disabled feature', async () => {
      (prisma.tierFeatureFlag!.findUnique as jest.Mock).mockResolvedValue({
        tierLevel: 'starter',
        featureKey: 'api_access',
        enabled: false,
        limitValue: null,
      });

      const result = await checkFeature('starter', 'api_access');

      expect(result).toEqual({
        isEnabled: false,
        limitValue: undefined,
        tier: 'starter',
      });
    });

    it('returns disabled for missing feature record', async () => {
      (prisma.tierFeatureFlag!.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await checkFeature('starter', 'unknown_feature' as FeatureKey);

      expect(result.isEnabled).toBe(false);
    });

    it('includes limitValue in result when present', async () => {
      (prisma.tierFeatureFlag!.findUnique as jest.Mock).mockResolvedValue({
        tierLevel: 'professional',
        featureKey: 'max_users',
        enabled: true,
        limitValue: 3,
      });

      const result = await checkFeature('professional', 'max_users' as FeatureKey);

      expect(result.limitValue).toBe(3);
    });
  });

  describe('Feature gating by tier (Task 5.7)', () => {
    const tierFeatures = {
      starter: ['max_skus', 'max_users'],
      professional: ['max_skus', 'max_users', 'api_access', 'priority_support'],
      premium: [
        'max_skus',
        'max_users',
        'api_access',
        'priority_support',
        'advanced_analytics',
        'dedicated_support',
      ],
      concierge: [
        'max_skus',
        'max_users',
        'api_access',
        'priority_support',
        'advanced_analytics',
        'dedicated_support',
        'custom_integrations',
      ],
    };

    it('starter tier does not have advanced_analytics', async () => {
      req.tierLevel = 'starter';

      (prisma.tierFeatureFlag!.findUnique as jest.Mock).mockResolvedValue({
        enabled: false,
      });

      const middleware = requireFeature('advanced_analytics');
      await middleware(req as AuthRequest, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('professional tier has api_access', async () => {
      req.tierLevel = 'professional';

      (prisma.tierFeatureFlag!.findUnique as jest.Mock).mockResolvedValue({
        enabled: true,
      });

      const middleware = requireFeature('api_access');
      await middleware(req as AuthRequest, res as Response, next);

      expect(next).toHaveBeenCalled();
    });

    it('premium tier has advanced_analytics and dedicated_support', async () => {
      req.tierLevel = 'premium';

      const middleware1 = requireFeature('advanced_analytics');
      const middleware2 = requireFeature('dedicated_support');

      (prisma.tierFeatureFlag!.findUnique as jest.Mock).mockResolvedValue({
        enabled: true,
      });

      await middleware1(req as AuthRequest, res as Response, next);
      expect(next).toHaveBeenCalled();

      jest.clearAllMocks();
      next = jest.fn();

      await middleware2(req as AuthRequest, res as Response, next);
      expect(next).toHaveBeenCalled();
    });

    it('concierge tier has custom_integrations', async () => {
      req.tierLevel = 'concierge';

      (prisma.tierFeatureFlag!.findUnique as jest.Mock).mockResolvedValue({
        enabled: true,
      });

      const middleware = requireFeature('custom_integrations');
      await middleware(req as AuthRequest, res as Response, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('Usage limit enforcement (Task 5.8)', () => {
    it('Starter tier has 500 SKU limit', async () => {
      (prisma.organizationUsage!.findUnique as jest.Mock).mockResolvedValue({
        totalSkus: 500,
        maxSkus: 500,
        activeUsers: 1,
        maxUsers: 1,
        storageUsedBytes: 0,
      });

      const middleware = checkUsageLimit('max_skus');
      await middleware(req as AuthRequest, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('Professional tier has 2000 SKU limit', async () => {
      req.tierLevel = 'professional';

      (prisma.organizationUsage!.findUnique as jest.Mock).mockResolvedValue({
        totalSkus: 2000,
        maxSkus: 2000,
        activeUsers: 3,
        maxUsers: 3,
        storageUsedBytes: 0,
      });

      const middleware = checkUsageLimit('max_skus');
      await middleware(req as AuthRequest, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('Premium tier has unlimited SKUs but enforcement still applies', async () => {
      req.tierLevel = 'premium';

      (prisma.organizationUsage!.findUnique as jest.Mock).mockResolvedValue({
        totalSkus: 99999,
        maxSkus: 999999, // Very high limit for premium
        activeUsers: 10,
        maxUsers: 10,
        storageUsedBytes: 0,
      });

      const middleware = checkUsageLimit('max_skus');
      await middleware(req as AuthRequest, res as Response, next);

      expect(next).toHaveBeenCalled();
    });

    it('Starter tier has 1 user limit', async () => {
      (prisma.organizationUsage!.findUnique as jest.Mock).mockResolvedValue({
        totalSkus: 100,
        maxSkus: 500,
        activeUsers: 0, // Below limit
        maxUsers: 1,
        storageUsedBytes: 0,
      });

      const middleware = checkUsageLimit('max_users');
      await middleware(req as AuthRequest, res as Response, next);

      expect(next).toHaveBeenCalled();
    });

    it('Professional tier has 3 user limit', async () => {
      req.tierLevel = 'professional';

      (prisma.organizationUsage!.findUnique as jest.Mock).mockResolvedValue({
        totalSkus: 100,
        maxSkus: 2000,
        activeUsers: 2, // Below limit
        maxUsers: 3,
        storageUsedBytes: 0,
      });

      const middleware = checkUsageLimit('max_users');
      await middleware(req as AuthRequest, res as Response, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
