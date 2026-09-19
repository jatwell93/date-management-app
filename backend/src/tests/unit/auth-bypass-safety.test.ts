import type { Response, NextFunction } from 'express';

// `authenticateToken`'s rejection path tracks an analytics event, which would reach the
// database. The matrix below only cares whether the bypass branch was taken, so stub it.
vi.mock('../../services/analytics.service', () => ({
  AnalyticsService: { getInstance: () => ({ trackEvent: vi.fn() }) },
  AnalyticsEventType: { USER_LOGOUT: 'USER_LOGOUT' },
}));

import { authenticateToken, AuthRequest } from '../../middleware/auth.middleware';
import { clerkAuth, ClerkAuthRequest } from '../../middleware/clerk-auth.middleware';
import { InventoryService } from '../../services/inventory.service';
import { getOrganizationId, isTestAuthBypassEnabled } from '../../utils/auth-bypass';

describe('Auth Bypass Safety', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalTestAuthBypass = process.env.TEST_AUTH_BYPASS;

  afterEach(() => {
    // Restore original environment variables
    process.env.NODE_ENV = originalNodeEnv;
    process.env.TEST_AUTH_BYPASS = originalTestAuthBypass;
  });

  describe('isTestAuthBypassEnabled', () => {
    it('should return true only when NODE_ENV is test and the flag is set', () => {
      process.env.NODE_ENV = 'test';
      process.env.TEST_AUTH_BYPASS = 'true';
      expect(isTestAuthBypassEnabled()).toBe(true);
    });

    it('should return false when NODE_ENV is test but the flag is absent', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.TEST_AUTH_BYPASS;
      expect(isTestAuthBypassEnabled()).toBe(false);
    });

    it('should return false when the flag is set outside a test NODE_ENV', () => {
      // The reason this helper is `&&` and not `||`: setting TEST_AUTH_BYPASS in a
      // deployed environment must not switch the bypass on, because the middleware
      // guards it has to agree with would still be refusing to bypass there.
      process.env.NODE_ENV = 'production';
      process.env.TEST_AUTH_BYPASS = 'true';
      expect(isTestAuthBypassEnabled()).toBe(false);
    });

    it('should return false in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.TEST_AUTH_BYPASS = 'false';
      expect(isTestAuthBypassEnabled()).toBe(false);
    });
  });

  describe('agreement with the middleware bypass guard', () => {
    const matrix: Array<{ nodeEnv: string; flag: string | undefined }> = [
      { nodeEnv: 'test', flag: 'true' },
      { nodeEnv: 'test', flag: undefined },
      { nodeEnv: 'production', flag: 'true' },
      { nodeEnv: 'production', flag: 'false' },
    ];

    it.each(matrix)(
      'clerkAuth bypasses exactly when isTestAuthBypassEnabled says so (NODE_ENV=$nodeEnv, TEST_AUTH_BYPASS=$flag)',
      async ({ nodeEnv, flag }) => {
        process.env.NODE_ENV = nodeEnv;
        if (flag === undefined) {
          delete process.env.TEST_AUTH_BYPASS;
        } else {
          process.env.TEST_AUTH_BYPASS = flag;
        }

        // No Authorization header: the only way `next` is reached is the bypass branch.
        const req = { headers: {} } as ClerkAuthRequest;
        const res = {
          status: vi.fn().mockReturnThis(),
          json: vi.fn().mockReturnThis(),
        } as unknown as Response;
        const next = vi.fn() as unknown as NextFunction;

        await clerkAuth(req, res, next);

        const middlewareBypassed =
          (next as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0;
        expect(middlewareBypassed).toBe(isTestAuthBypassEnabled());
        // And the bypass is the only thing that could have produced it.
        expect(req.auth?.userId).toBe(middlewareBypassed ? 'user_test_123' : undefined);
      },
    );

    it.each(matrix)(
      'authenticateToken bypasses exactly when isTestAuthBypassEnabled says so (NODE_ENV=$nodeEnv, TEST_AUTH_BYPASS=$flag)',
      async ({ nodeEnv, flag }) => {
        process.env.NODE_ENV = nodeEnv;
        if (flag === undefined) {
          delete process.env.TEST_AUTH_BYPASS;
        } else {
          process.env.TEST_AUTH_BYPASS = flag;
        }

        // Same construction as above: no token, so `next` is reachable only via bypass.
        const req = {
          headers: {},
          get: () => undefined,
          path: '/x',
          method: 'GET',
        } as unknown as AuthRequest;
        const res = {
          status: vi.fn().mockReturnThis(),
          json: vi.fn().mockReturnThis(),
        } as unknown as Response;
        const next = vi.fn() as unknown as NextFunction;

        await authenticateToken(req, res, next);

        const middlewareBypassed =
          (next as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0;
        expect(middlewareBypassed).toBe(isTestAuthBypassEnabled());
        expect(req.organizationId).toBe(middlewareBypassed ? 'default-org' : undefined);
      },
    );
  });

  describe('getOrganizationId', () => {
    it('should return provided organizationId', () => {
      const result = getOrganizationId('org-123');
      expect(result).toBe('org-123');
    });

    it('should return test bypass ID when the bypass is fully enabled', () => {
      process.env.NODE_ENV = 'test';
      process.env.TEST_AUTH_BYPASS = 'true';
      const result = getOrganizationId();
      expect(result).toBe('default-org');
    });

    it('should throw when NODE_ENV is test but the flag is absent', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.TEST_AUTH_BYPASS;
      expect(() => getOrganizationId()).toThrow(
        'Organization ID is required unless the test auth bypass is enabled',
      );
    });

    it('should throw when the flag is set outside a test NODE_ENV', () => {
      // The cross-tenant case this task closes: a deployed process with the flag
      // set must not silently scope an org-less service to the shared test tenant.
      process.env.NODE_ENV = 'production';
      process.env.TEST_AUTH_BYPASS = 'true';
      expect(() => getOrganizationId()).toThrow(
        'Organization ID is required unless the test auth bypass is enabled',
      );
    });

    it('should throw error in production without organizationId', () => {
      process.env.NODE_ENV = 'production';
      process.env.TEST_AUTH_BYPASS = 'false';
      expect(() => getOrganizationId()).toThrow(
        'Organization ID is required unless the test auth bypass is enabled',
      );
    });
  });

  describe('InventoryService Safety', () => {
    it('should work with explicit organizationId', () => {
      const service = new InventoryService('org-123');
      expect(service).toBeDefined();
    });

    it('should work when the test auth bypass is fully enabled', () => {
      process.env.NODE_ENV = 'test';
      process.env.TEST_AUTH_BYPASS = 'true';
      const service = new InventoryService();
      expect(service).toBeDefined();
    });

    it('should throw when the flag is set outside a test NODE_ENV', () => {
      process.env.NODE_ENV = 'production';
      process.env.TEST_AUTH_BYPASS = 'true';
      expect(() => new InventoryService()).toThrow(
        'Organization ID is required unless the test auth bypass is enabled',
      );
    });

    it('should throw error in production without organizationId', () => {
      process.env.NODE_ENV = 'production';
      process.env.TEST_AUTH_BYPASS = 'false';
      expect(() => new InventoryService()).toThrow(
        'Organization ID is required unless the test auth bypass is enabled',
      );
    });
  });
});
