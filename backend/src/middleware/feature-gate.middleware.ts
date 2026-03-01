import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { AnalyticsService, AnalyticsEventType } from '../services/analytics.service';
import { Logger } from '../utils/logger';
import * as Sentry from '@sentry/node';

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

      // Check feature availability
      const result = await checkFeature(req.tierLevel, featureKey);

      if (!result.isEnabled) {
        return handleFeatureDenied(req, res, featureKey);
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
 * Handle feature access denial (analytics, logging, response)
 */
function handleFeatureDenied(req: AuthRequest, res: Response, featureKey: FeatureKey) {
  const analyticsService = AnalyticsService.getInstance();

  // Enhanced tracking for conversion opportunities
  analyticsService.trackEvent({
    userId: req.userId,
    eventType: AnalyticsEventType.FEATURE_ACCESS_DENIED,
    eventCategory: 'FeatureGating',
    eventAction: 'feature_access_denied',
    ipAddress: req.ip,
    userAgent: req.get('User-Agent') || undefined,
    metadata: {
      featureKey,
      tierLevel: req.tierLevel,
      organizationId: req.organizationId,
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString(),
    },
  });

  // Detailed logging for conversion analysis
  const logContext = {
    featureKey,
    tierLevel: req.tierLevel,
    organizationId: req.organizationId,
    userId: req.userId,
    path: req.path,
    method: req.method,
    correlationId: req.headers?.['x-correlation-id'],
    timestamp: new Date().toISOString(),
  };

  Logger.warn('Feature access denied - conversion opportunity', logContext);

  // Send to Sentry for tracking popular features that drive upgrades
  Sentry.addBreadcrumb({
    category: 'feature_gate',
    message: `Feature ${featureKey} blocked for tier ${req.tierLevel}`,
    level: 'info',
    data: logContext,
  });

  return res.status(403).json({
    message: `Feature "${featureKey}" is not available on your ${req.tierLevel} tier`,
    feature: featureKey,
    currentTier: req.tierLevel,
    upgradeCTA: `Upgrade to access ${featureKey}`,
    upgradeUrl: '/subscription/upgrade',
  });
}

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
      const organizationUsage = await getOrCreateOrganizationUsage(prisma, req.organizationId);

      // Check creation lock — applied by webhook handler on over-limit downgrade/cancellation
      const org = await prisma.organization.findUnique({
        where: { id: req.organizationId },
        select: { isCreationLocked: true },
      });

      if (org?.isCreationLocked && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
        Logger.warn('Creation locked: org over limit, blocking write operation', {
          organizationId: req.organizationId,
          limitKey,
          path: req.path,
          method: req.method,
        });

        return res.status(403).json({
          message:
            'Your account is creation-locked because your current usage exceeds your subscription tier limits. Remove items or upgrade to re-enable creation.',
          locked: true,
          limitKey,
          upgradeCTA: 'Upgrade your plan to unlock creation',
          upgradeUrl: '/subscription/upgrade',
        });
      }

      // Determine the limit and usage based on limitKey
      const { currentUsage, limit } = await calculateUsageAndLimit(
        prisma,
        limitKey,
        organizationUsage,
        req.organizationId,
      );

      const percentageUsed = limit > 0 ? (currentUsage / limit) * 100 : 100;
      const limitExceeded = currentUsage >= limit;

      // Task 5.6: Return 403 Forbidden with upgrade message if limit reached
      if (limitExceeded) {
        return handleLimitExceeded(req, res, limitKey, currentUsage, limit, percentageUsed);
      }

      // Warn if approaching limit (80%)
      if (percentageUsed >= 80) {
        handleApproachingLimit(req, res, limitKey, currentUsage, limit, percentageUsed);
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

async function getOrCreateOrganizationUsage(prisma: any, organizationId: string) {
  let usage = await prisma.organizationUsage.findUnique({
    where: { organizationId },
  });

  if (!usage) {
    Logger.warn('Organization usage record not found', { organizationId });
    // Create default usage record if not exists
    usage = await prisma.organizationUsage.create({
      data: {
        organizationId,
        activeUsers: 0,
        maxUsers: 1,
        totalSkus: 0,
        maxSkus: 500,
        storageUsedBytes: 0,
      },
    });
  }
  return usage;
}

async function calculateUsageAndLimit(
  prisma: any,
  limitKey: LimitKey,
  usage: any,
  organizationId: string,
): Promise<{ currentUsage: number; limit: number }> {
  let currentUsage = 0;
  let limit = 0;

  if (limitKey === 'max_skus') {
    currentUsage = usage.totalSkus;
    limit = usage.maxSkus;
  } else if (limitKey === 'max_users') {
    currentUsage = usage.activeUsers;
    limit = usage.maxUsers;
  } else if (limitKey === 'storage_bytes') {
    currentUsage = usage.storageUsedBytes;
    // Get max storage from subscription tier limits
    const subscriptionTier = await prisma.subscriptionTier.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    // Assume storage limit in tier feature flags (default to 10GB)
    limit = subscriptionTier ? 10737418240 : 10737418240;
  }

  return { currentUsage, limit };
}

function handleLimitExceeded(
  req: AuthRequest,
  res: Response,
  limitKey: LimitKey,
  currentUsage: number,
  limit: number,
  percentageUsed: number,
) {
  const analyticsService = AnalyticsService.getInstance();

  // Track usage limit exceeded for conversion analysis
  analyticsService.trackEvent({
    userId: req.userId,
    eventType: AnalyticsEventType.USAGE_LIMIT_EXCEEDED,
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
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString(),
    },
  });

  // Enhanced logging for business insights
  const logContext = {
    limitKey,
    currentUsage,
    limit,
    percentageUsed: Math.round(percentageUsed * 100) / 100,
    organizationId: req.organizationId,
    userId: req.userId,
    tierLevel: req.tierLevel,
    path: req.path,
    method: req.method,
    correlationId: req.headers?.['x-correlation-id'],
    timestamp: new Date().toISOString(),
  };

  Logger.warn('Usage limit exceeded - upgrade opportunity', logContext);

  // Send to Sentry for tracking usage patterns
  Sentry.addBreadcrumb({
    category: 'usage_limit',
    message: `Limit ${limitKey} exceeded (${percentageUsed.toFixed(1)}%)`,
    level: 'warning',
    data: logContext,
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

function handleApproachingLimit(
  req: AuthRequest,
  res: Response,
  limitKey: LimitKey,
  currentUsage: number,
  limit: number,
  percentageUsed: number,
) {
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
