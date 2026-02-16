import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { AnalyticsService, AnalyticsEventType } from '../services/analytics.service';
import { Logger } from '../utils/logger';

// Feature keys from tier_feature_flags table
export type FeatureKey =
  | 'max_skus'
  | 'max_users'
  | 'advanced_analytics'
  | 'api_access'
  | 'priority_support'
  | 'dedicated_support'
  | 'custom_integrations';

// Usage limit keys
export type LimitKey = 'max_skus' | 'max_users' | 'storage_bytes';

export interface FeatureCheckResult {
  isEnabled: boolean;
  limitValue?: number;
  tier: string;
}

export interface UsageLimitResult {
  isWithinLimit: boolean;
  currentUsage: number;
  limit: number;
  percentageUsed: number;
}

/**
 * Middleware to check if a feature is enabled for the user's tier
 * Returns 403 Forbidden with upgrade CTA if not enabled
 * Task 5.1-5.3
 */
export const requireFeature = (featureKey: FeatureKey) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.organizationId || !req.tierLevel) {
        return res.status(403).json({
          message: 'Access denied: Missing tenant context',
        });
      }

      const prisma = getDefaultDatabaseClient();

      // Task 5.2: Query tier_feature_flags by tierLevel and featureKey
      const featureFlag = await prisma.tierFeatureFlag.findUnique({
        where: {
          tierLevel_featureKey: {
            tierLevel: req.tierLevel,
            featureKey,
          },
        },
      });

      // Task 5.3: Return 403 Forbidden if feature not enabled for tier with upgrade CTA
      if (!featureFlag || !featureFlag.enabled) {
        const analyticsService = AnalyticsService.getInstance();
        analyticsService.trackEvent({
          userId: req.userId,
          eventType: AnalyticsEventType.USER_LOGOUT,
          eventCategory: 'FeatureGating',
          eventAction: 'feature_access_denied',
          ipAddress: req.ip,
          userAgent: req.get('User-Agent') || undefined,
          metadata: {
            featureKey,
            tierLevel: req.tierLevel,
            organizationId: req.organizationId,
          },
        });

        Logger.warn('Feature access denied', {
          featureKey,
          tierLevel: req.tierLevel,
          organizationId: req.organizationId,
          userId: req.userId,
        });

        return res.status(403).json({
          message: `Feature "${featureKey}" is not available on your ${req.tierLevel} tier`,
          feature: featureKey,
          currentTier: req.tierLevel,
          upgradeCTA: `Upgrade to access ${featureKey}`,
          upgradeUrl: '/subscription/upgrade',
        });
      }

      Logger.debug('Feature access granted', {
        featureKey,
        tierLevel: req.tierLevel,
        organizationId: req.organizationId,
      });

      next();
    } catch (error) {
      Logger.error('Error checking feature access', {
        error: error instanceof Error ? error.message : 'Unknown error',
        featureKey,
        organizationId: req.organizationId,
      });

      return res.status(500).json({
        message: 'Error checking feature access',
      });
    }
  };
};

/**
 * Middleware to check if organization is within usage limits
 * Returns 403 Forbidden with upgrade CTA if limit exceeded
 * Task 5.4-5.6
 */
export const checkUsageLimit = (limitKey: LimitKey) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.organizationId) {
        return res.status(403).json({
          message: 'Access denied: Missing organization context',
        });
      }

      const prisma = getDefaultDatabaseClient();

      // Task 5.5: Implement usage limit check
      const organizationUsage = await prisma.organizationUsage.findUnique({
        where: { organizationId: req.organizationId },
      });

      if (!organizationUsage) {
        Logger.warn('Organization usage record not found', {
          organizationId: req.organizationId,
        });
        // Create default usage record if not exists
        await prisma.organizationUsage.create({
          data: {
            organizationId: req.organizationId,
            activeUsers: 0,
            maxUsers: 1, // Will be set by subscription tier
            totalSkus: 0,
            maxSkus: 500, // Will be set by subscription tier
            storageUsedBytes: 0,
          },
        });
        return next();
      }

      // Determine the limit based on limitKey
      let currentUsage = 0;
      let limit = 0;
      let limitExceeded = false;

      if (limitKey === 'max_skus') {
        currentUsage = organizationUsage.totalSkus;
        limit = organizationUsage.maxSkus;
        limitExceeded = currentUsage >= limit;
      } else if (limitKey === 'max_users') {
        currentUsage = organizationUsage.activeUsers;
        limit = organizationUsage.maxUsers;
        limitExceeded = currentUsage >= limit;
      } else if (limitKey === 'storage_bytes') {
        currentUsage = organizationUsage.storageUsedBytes;
        // Get max storage from subscription tier limits (typically in limitValue for storage)
        const subscriptionTier = await prisma.subscriptionTier.findFirst({
          where: { organizationId: req.organizationId },
          orderBy: { createdAt: 'desc' },
        });
        // Assume storage limit in tier feature flags (default to 10GB = 10737418240 bytes)
        limit = subscriptionTier ? 10737418240 : 10737418240;
        limitExceeded = currentUsage >= limit;
      }

      const percentageUsed = (currentUsage / limit) * 100;

      // Task 5.6: Return 403 Forbidden with upgrade message if limit reached
      if (limitExceeded) {
        const analyticsService = AnalyticsService.getInstance();
        analyticsService.trackEvent({
          userId: req.userId,
          eventType: AnalyticsEventType.USER_LOGOUT,
          eventCategory: 'UsageLimit',
          eventAction: 'usage_limit_exceeded',
          ipAddress: req.ip,
          userAgent: req.get('User-Agent') || undefined,
          metadata: {
            limitKey,
            currentUsage,
            limit,
            percentageUsed,
            organizationId: req.organizationId,
          },
        });

        Logger.warn('Usage limit exceeded', {
          limitKey,
          currentUsage,
          limit,
          organizationId: req.organizationId,
          userId: req.userId,
        });

        return res.status(403).json({
          message: `Usage limit reached for ${limitKey}`,
          limitKey,
          currentUsage,
          limit,
          percentageUsed,
          upgradeCTA: 'Upgrade your plan to increase limits',
          upgradeUrl: '/subscription/upgrade',
        });
      }

      // Warn if approaching limit (80%)
      if (percentageUsed >= 80) {
        Logger.warn('Usage approaching limit', {
          limitKey,
          currentUsage,
          limit,
          percentageUsed,
          organizationId: req.organizationId,
        });

        // Attach warning to response (optional)
        res.locals.usageWarning = {
          limitKey,
          currentUsage,
          limit,
          percentageUsed,
          message: `You are using ${percentageUsed.toFixed(0)}% of your ${limitKey} limit`,
        };
      }

      Logger.debug('Usage check passed', {
        limitKey,
        currentUsage,
        limit,
        percentageUsed,
        organizationId: req.organizationId,
      });

      next();
    } catch (error) {
      Logger.error('Error checking usage limit', {
        error: error instanceof Error ? error.message : 'Unknown error',
        limitKey,
        organizationId: req.organizationId,
      });

      return res.status(500).json({
        message: 'Error checking usage limit',
      });
    }
  };
};

/**
 * Helper function to check feature availability without middleware
 * Useful for service layer logic
 */
export const checkFeature = async (
  tierLevel: string,
  featureKey: FeatureKey,
): Promise<FeatureCheckResult> => {
  try {
    const prisma = getDefaultDatabaseClient();

    const featureFlag = await prisma.tierFeatureFlag.findUnique({
      where: {
        tierLevel_featureKey: {
          tierLevel,
          featureKey,
        },
      },
    });

    return {
      isEnabled: featureFlag?.enabled ?? false,
      limitValue: featureFlag?.limitValue ?? undefined,
      tier: tierLevel,
    };
  } catch (error) {
    Logger.error('Error checking feature', {
      error: error instanceof Error ? error.message : 'Unknown error',
      tierLevel,
      featureKey,
    });
    return {
      isEnabled: false,
      tier: tierLevel,
    };
  }
};
