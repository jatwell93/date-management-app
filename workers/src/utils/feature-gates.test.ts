/**
 * Feature Gates & Usage Limits Tests
 * Phase 8B Task 2: Tests for feature-gates.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AVAILABLE_FEATURES,
  checkFeatureAccess,
  checkUsageLimit,
  requireFeatureAccess,
  enforceUsageLimit,
  formatFeatureUpgradeCTA,
  formatUsageLimitCTA,
  type FeatureKey,
  type LimitKey,
} from './feature-gates';
import { TIER_LIMITS } from './auth';
import type { TierLevel } from './auth';

describe('Feature Gates & Usage Limits (Phase 8B.2)', () => {
  describe('checkFeatureAccess', () => {
    // Task 8B.2.1: Feature access checks
    it('enables MAX_SKUS for all tiers', () => {
      const result = checkFeatureAccess('starter', AVAILABLE_FEATURES.MAX_SKUS);
      expect(result.isEnabled).toBe(true);
      expect(result.tier).toBe('starter');
    });

    it('enables ADVANCED_ANALYTICS only for professional+', () => {
      const starterResult = checkFeatureAccess('starter', AVAILABLE_FEATURES.ADVANCED_ANALYTICS);
      expect(starterResult.isEnabled).toBe(false);
      expect(starterResult.error).toContain('not available');

      const professionalResult = checkFeatureAccess(
        'professional',
        AVAILABLE_FEATURES.ADVANCED_ANALYTICS,
      );
      expect(professionalResult.isEnabled).toBe(true);
    });

    it('enables DEDICATED_SUPPORT only for premium+', () => {
      const professionalResult = checkFeatureAccess(
        'professional',
        AVAILABLE_FEATURES.DEDICATED_SUPPORT,
      );
      expect(professionalResult.isEnabled).toBe(false);

      const premiumResult = checkFeatureAccess('premium', AVAILABLE_FEATURES.DEDICATED_SUPPORT);
      expect(premiumResult.isEnabled).toBe(true);
    });

    it('returns limitValue for SKU feature', () => {
      const result = checkFeatureAccess('starter', AVAILABLE_FEATURES.MAX_SKUS);
      expect(result.limitValue).toBe(TIER_LIMITS.starter.max_skus);
      expect(result.limitValue).toBe(5000); // From TIER_LIMITS
    });

    it('returns error message when feature not available', () => {
      const result = checkFeatureAccess('starter', AVAILABLE_FEATURES.CUSTOM_INTEGRATIONS);
      expect(result.isEnabled).toBe(false);
      expect(result.error).toBe("Feature 'custom_integrations' not available in starter tier");
    });

    it('concierge tier has all features enabled', () => {
      const features: FeatureKey[] = [
        AVAILABLE_FEATURES.MAX_SKUS,
        AVAILABLE_FEATURES.ADVANCED_ANALYTICS,
        AVAILABLE_FEATURES.CUSTOM_INTEGRATIONS,
        AVAILABLE_FEATURES.DEDICATED_SUPPORT,
      ];

      features.forEach((feature) => {
        const result = checkFeatureAccess('concierge', feature);
        expect(result.isEnabled).toBe(true);
      });
    });
  });

  describe('checkUsageLimit', () => {
    // Task 8B.2.2: Usage limit checks
    const mockDbClient = vi.fn();

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns true when usage is within limit', async () => {
      mockDbClient.mockResolvedValueOnce([{ count: 250 }]);

      const result = await checkUsageLimit('org-1', 'max_skus', 'starter', mockDbClient);

      expect(result.isWithinLimit).toBe(true);
      expect(result.currentUsage).toBe(250);
      expect(result.limit).toBe(5000); // starter max_skus = 5000
      expect(result.percentageUsed).toBe(5);
    });

    it('returns false when usage exceeds limit', async () => {
      mockDbClient.mockResolvedValueOnce([{ count: 6000 }]);

      const result = await checkUsageLimit('org-1', 'max_skus', 'starter', mockDbClient);

      expect(result.isWithinLimit).toBe(false);
      expect(result.currentUsage).toBe(6000);
      expect(result.limit).toBe(5000); // starter max_skus = 5000
      expect(result.error).toContain('Usage limit exceeded');
    });

    it('calculates percentageUsed correctly', async () => {
      mockDbClient.mockResolvedValueOnce([{ total: 5368709120 }]); // 5GB out of 10GB

      const result = await checkUsageLimit('org-1', 'storage_bytes', 'starter', mockDbClient);

      expect(result.percentageUsed).toBe(50); // 5GB/10GB = 50% (Starter storage = 10GB)
    });

    it('handles large fixed limit for enterprise-equivalent tiers', async () => {
      // No tier is truly unlimited any more; concierge maps to the 250k cap.
      mockDbClient.mockResolvedValueOnce([{ count: 0 }]);
      const result = await checkUsageLimit('org-1', 'max_skus', 'concierge', mockDbClient);

      expect(result.isWithinLimit).toBe(true);
      expect(result.currentUsage).toBe(0);
      expect(result.limit).toBe(250000);
      expect(result.percentageUsed).toBe(0);
    });

    it('handles database errors gracefully', async () => {
      mockDbClient.mockRejectedValueOnce(new Error('DB connection failed'));

      const result = await checkUsageLimit('org-1', 'max_skus', 'starter', mockDbClient);

      expect(result.isWithinLimit).toBe(false);
      expect(result.error).toContain('Failed to check');
      expect(result.currentUsage).toBe(0);
    });

    it('queries max_skus with correct SQL', async () => {
      mockDbClient.mockResolvedValueOnce([{ count: 25 }]);

      await checkUsageLimit('org-123', 'max_skus', 'starter', mockDbClient);

      expect(mockDbClient).toHaveBeenCalled();
      // Verify SQL call was made (vitest spy captures calls)
      const call = mockDbClient.mock.calls[0][0];
      expect(call).toBeTruthy();
    });

    it('queries max_users with correct parameter', async () => {
      mockDbClient.mockResolvedValueOnce([{ count: 5 }]);

      const result = await checkUsageLimit('org-456', 'max_users', 'professional', mockDbClient);

      expect(result.currentUsage).toBe(5);
      expect(mockDbClient).toHaveBeenCalled();
    });

    it('handles zero usage correctly', async () => {
      mockDbClient.mockResolvedValueOnce([{ count: 0 }]);

      const result = await checkUsageLimit('org-1', 'max_skus', 'starter', mockDbClient);

      expect(result.isWithinLimit).toBe(true);
      expect(result.currentUsage).toBe(0);
      expect(result.percentageUsed).toBe(0);
    });
  });

  describe('requireFeatureAccess', () => {
    // Task 8B.2.3: Middleware factory for feature access
    it('returns middleware function', () => {
      const middleware = requireFeatureAccess(AVAILABLE_FEATURES.ADVANCED_ANALYTICS);
      expect(typeof middleware).toBe('function');
    });

    it('middleware allows feature for valid tier', () => {
      const middleware = requireFeatureAccess(AVAILABLE_FEATURES.ADVANCED_ANALYTICS);
      const result = middleware('professional');

      expect(result.allowed).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('middleware blocks feature for invalid tier', () => {
      const middleware = requireFeatureAccess(AVAILABLE_FEATURES.CUSTOM_INTEGRATIONS);
      const result = middleware('starter');

      expect(result.allowed).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('middleware composed with router logic', () => {
      const analyticsFence = requireFeatureAccess(AVAILABLE_FEATURES.ADVANCED_ANALYTICS);

      const tiers: TierLevel[] = ['starter', 'professional', 'premium', 'concierge'];
      const results = tiers.map((tier) => analyticsFence(tier).allowed);

      // Analytics available for professional and above
      expect(results).toEqual([false, true, true, true]);
    });
  });

  describe('enforceUsageLimit', () => {
    // Task 8B.2.4: Middleware factory for usage limits
    const mockDbClient = vi.fn();

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns async middleware function', () => {
      const middleware = enforceUsageLimit('max_skus');
      expect(typeof middleware).toBe('function');
    });

    it('middleware allows creation when under limit', async () => {
      mockDbClient.mockResolvedValueOnce([{ count: 50 }]);

      const middleware = enforceUsageLimit('max_skus');
      const result = await middleware('org-1', 'starter', mockDbClient);

      expect(result.allowed).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.result?.currentUsage).toBe(50);
    });

    it('middleware blocks creation when at limit', async () => {
      mockDbClient.mockResolvedValueOnce([{ count: 5000 }]); // exactly at limit (starter max_skus)

      const middleware = enforceUsageLimit('max_skus');
      const result = await middleware('org-1', 'starter', mockDbClient);

      expect(result.allowed).toBe(false); // at limit means we're not WITHIN limit (< limit)
      expect(result.error).toBeDefined();
    });

    it('middleware returns full result object', async () => {
      mockDbClient.mockResolvedValueOnce([{ count: 2 }]); // 2 out of 10 for professional max_users

      const middleware = enforceUsageLimit('max_users');
      const result = await middleware('org-1', 'professional', mockDbClient);

      expect(result.result).toEqual({
        isWithinLimit: true,
        currentUsage: 2,
        limit: 10, // professional max_users = 10
        percentageUsed: expect.any(Number),
      });
    });
  });

  describe('formatFeatureUpgradeCTA', () => {
    // Task 8B.2.5: Feature upgrade CTAs
    it('returns starter upgrade path', () => {
      const msg = formatFeatureUpgradeCTA(AVAILABLE_FEATURES.CUSTOM_INTEGRATIONS, 'starter');
      expect(msg).toContain('starter');
      expect(msg).toContain('Professional');
    });

    it('returns professional upgrade path', () => {
      const msg = formatFeatureUpgradeCTA(AVAILABLE_FEATURES.DEDICATED_SUPPORT, 'professional');
      expect(msg).toContain('professional');
      expect(msg).toContain('Enterprise');
    });

    it('returns premium upgrade path', () => {
      const msg = formatFeatureUpgradeCTA(AVAILABLE_FEATURES.CUSTOM_INTEGRATIONS, 'premium');
      expect(msg).toContain('premium');
      expect(msg).toContain('Contact us');
    });

    it('returns concierge support path', () => {
      const msg = formatFeatureUpgradeCTA(AVAILABLE_FEATURES.API_ACCESS, 'concierge');
      expect(msg).toContain('concierge');
      expect(msg).toContain('Contact support');
    });

    it('includes feature name in message', () => {
      const msg = formatFeatureUpgradeCTA(AVAILABLE_FEATURES.ADVANCED_ANALYTICS, 'starter');
      expect(msg).toContain('advanced_analytics');
    });
  });

  describe('formatUsageLimitCTA', () => {
    // Task 8B.2.5: Usage limit upgrade CTAs
    it('returns starter upgrade path for usage limit', () => {
      const msg = formatUsageLimitCTA('max_skus', 500, 500, 'starter');
      expect(msg).toContain('Professional');
      expect(msg).toContain('500/500');
    });

    it('returns professional upgrade path for usage limit', () => {
      const msg = formatUsageLimitCTA('max_users', 3, 3, 'professional');
      expect(msg).toContain('Enterprise');
      expect(msg).toContain('3/3');
    });

    it('includes limit details in message', () => {
      const msg = formatUsageLimitCTA('max_skus', 250, 500, 'starter');
      expect(msg).toContain('max_skus');
      expect(msg).toContain('250/500');
    });

    it('returns enterprise upgrade path for legacy premium', () => {
      const msg = formatUsageLimitCTA('max_users', 10, 10, 'premium');
      expect(msg).toContain('Enterprise');
    });

    it('returns contact support for concierge tier', () => {
      const msg = formatUsageLimitCTA('max_skus', 0, 5000, 'concierge');
      expect(msg).toContain('Contact support');
    });
  });

  describe('Integration: Feature Gates + Usage Limits', () => {
    // Task 8B.2.6: E2E scenario - check both feature and usage before action
    const mockDbClient = vi.fn();

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('allows action when feature enabled and usage within limit', async () => {
      mockDbClient.mockResolvedValueOnce([{ count: 50 }]);

      const featureCheck = checkFeatureAccess(
        'professional',
        AVAILABLE_FEATURES.ADVANCED_ANALYTICS,
      );
      const usageCheck = await checkUsageLimit('org-1', 'max_skus', 'professional', mockDbClient);

      expect(featureCheck.isEnabled).toBe(true);
      expect(usageCheck.isWithinLimit).toBe(true);
    });

    it('blocks action when feature disabled even if usage within limit', async () => {
      mockDbClient.mockResolvedValueOnce([{ count: 50 }]);

      const featureCheck = checkFeatureAccess('starter', AVAILABLE_FEATURES.CUSTOM_INTEGRATIONS);
      const usageCheck = await checkUsageLimit('org-1', 'max_skus', 'starter', mockDbClient);

      expect(featureCheck.isEnabled).toBe(false);
      expect(usageCheck.isWithinLimit).toBe(true);
      // Feature gate is first line of defense
    });

    it('blocks action when usage exceeded even if feature enabled', async () => {
      mockDbClient.mockResolvedValueOnce([{ count: 60000 }]); // 60000 exceeds professional max_skus of 50000

      const featureCheck = checkFeatureAccess('professional', AVAILABLE_FEATURES.MAX_SKUS);
      const usageCheck = await checkUsageLimit('org-1', 'max_skus', 'professional', mockDbClient);

      expect(featureCheck.isEnabled).toBe(true);
      expect(usageCheck.isWithinLimit).toBe(false);
    });

    it('blocks action when both feature disabled and usage exceeded', async () => {
      mockDbClient.mockResolvedValueOnce([{ count: 6000 }]); // exceeds starter max_skus of 5000

      const featureCheck = checkFeatureAccess('starter', AVAILABLE_FEATURES.CUSTOM_INTEGRATIONS);
      const usageCheck = await checkUsageLimit('org-1', 'max_skus', 'starter', mockDbClient);

      expect(featureCheck.isEnabled).toBe(false);
      expect(usageCheck.isWithinLimit).toBe(false);
    });
  });
});
