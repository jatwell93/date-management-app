/**
 * Feature Gate & Usage Limit Enforcement
 * Phase 8B Task 2: Feature Gates & Usage Limits (8B.2)
 *
 * Provides tier-based feature access and usage limit enforcement for Cloudflare Workers.
 * Ported from backend/src/middleware/feature-gate.middleware.ts with edge optimization.
 */

import {
  TIER_LIMITS,
  TierLevel,
  AVAILABLE_FEATURES,
} from '../../../shared/types/subscription';

// Re-export for external consumers
export { AVAILABLE_FEATURES };

/**
 * Feature flag keys available for tier-based gating
 */
export type FeatureKey = (typeof AVAILABLE_FEATURES)[keyof typeof AVAILABLE_FEATURES];

/**
 * Usage limit keys for resource tracking
 */
export type LimitKey = 'max_skus' | 'max_users' | 'storage_bytes' | 'max_inventory_items';

/**
 * Result of feature access check
 */
export interface FeatureCheckResult {
  isEnabled: boolean;
  limitValue?: number;
  tier: TierLevel;
  error?: string;
}

/**
 * Result of usage limit check
 */
export interface UsageLimitResult {
  isWithinLimit: boolean;
  currentUsage: number;
  limit: number | null;
  percentageUsed: number;
  error?: string;
}

/**
 * Task 8B.2.1: Check if feature is enabled for user's tier
 * ported from backend/src/middleware/feature-gate.middleware.ts
 *
 * @param tierLevel - User's subscription tier
 * @param featureKey - Feature to check access for
 * @returns FeatureCheckResult with access status
 */
export function checkFeatureAccess(
  tierLevel: TierLevel,
  featureKey: FeatureKey,
): FeatureCheckResult {
  // Map feature keys to tier limits
  // Some features map directly to tier limits, others are tier-based
  const tierFeatureMap: Record<TierLevel, Set<FeatureKey>> = {
    free: new Set([AVAILABLE_FEATURES.MAX_SKUS, AVAILABLE_FEATURES.MAX_USERS]),
    starter: new Set([AVAILABLE_FEATURES.MAX_SKUS, AVAILABLE_FEATURES.MAX_USERS]),
    professional: new Set([
      AVAILABLE_FEATURES.MAX_SKUS,
      AVAILABLE_FEATURES.MAX_USERS,
      AVAILABLE_FEATURES.ADVANCED_ANALYTICS, // Professional tier gate
      AVAILABLE_FEATURES.API_ACCESS,
      AVAILABLE_FEATURES.PRIORITY_SUPPORT,
    ]),
    // `premium` and `concierge` are LEGACY tiers retained only as a migration bridge.
    // New tiers are free/starter/professional/enterprise; these map to
    // professional/enterprise via normalizeLaunchTier. Do not assign new customers here.
    premium: new Set([
      AVAILABLE_FEATURES.MAX_SKUS,
      AVAILABLE_FEATURES.MAX_USERS,
      AVAILABLE_FEATURES.ADVANCED_ANALYTICS,
      AVAILABLE_FEATURES.API_ACCESS,
      AVAILABLE_FEATURES.PRIORITY_SUPPORT,
      AVAILABLE_FEATURES.DEDICATED_SUPPORT,
      AVAILABLE_FEATURES.CUSTOM_INTEGRATIONS,
    ]),
    concierge: new Set([
      AVAILABLE_FEATURES.MAX_SKUS,
      AVAILABLE_FEATURES.MAX_USERS,
      AVAILABLE_FEATURES.ADVANCED_ANALYTICS,
      AVAILABLE_FEATURES.API_ACCESS,
      AVAILABLE_FEATURES.PRIORITY_SUPPORT,
      AVAILABLE_FEATURES.DEDICATED_SUPPORT,
      AVAILABLE_FEATURES.CUSTOM_INTEGRATIONS,
    ]),
    enterprise: new Set([
      AVAILABLE_FEATURES.MAX_SKUS,
      AVAILABLE_FEATURES.MAX_USERS,
      AVAILABLE_FEATURES.ADVANCED_ANALYTICS,
      AVAILABLE_FEATURES.API_ACCESS,
      AVAILABLE_FEATURES.PRIORITY_SUPPORT,
      AVAILABLE_FEATURES.DEDICATED_SUPPORT,
      AVAILABLE_FEATURES.CUSTOM_INTEGRATIONS,
    ]),
  };

  const hasFeature = tierFeatureMap[tierLevel]?.has(featureKey) ?? false;
  const rawLimitValue = TIER_LIMITS[tierLevel]?.[featureKey as LimitKey];
  const limitValue = rawLimitValue === null ? undefined : rawLimitValue;

  return {
    isEnabled: hasFeature,
    limitValue,
    tier: tierLevel,
    error: !hasFeature ? `Feature '${featureKey}' not available in ${tierLevel} tier` : undefined,
  };
}

/**
 * Task 8B.2.2: Check usage against tier limits
 * Ported from backend feature-gate.middleware.ts with optimizations for Workers
 *
 * @param organizationId - Organization to check usage for
 * @param limitKey - Usage metric to check (max_skus, max_users, etc)
 * @param tierLevel - User's tier level
 * @param dbClient - Database client for querying current usage
 * @returns UsageLimitResult with usage status
 */
export async function checkUsageLimit(
  organizationId: string,
  limitKey: LimitKey,
  tierLevel: TierLevel,
  dbClient: any,
): Promise<UsageLimitResult> {
  // Get tier limit
  const limit = TIER_LIMITS[tierLevel]?.[limitKey] ?? null;

  // Unlimited tiers return success
  if (limit === null) {
    return {
      isWithinLimit: true,
      currentUsage: 0,
      limit: null,
      percentageUsed: 0,
    };
  }

  // Query current usage based on limitKey
  let currentUsage = 0;

  try {
    if (limitKey === 'max_skus') {
      // Count products/SKUs for organization
      const result = await dbClient`
        SELECT COUNT(*) as count FROM "Product" 
        WHERE "organizationId" = ${organizationId} 
        AND "deletedAt" IS NULL
      `;
      currentUsage = result[0]?.count ?? 0;
    } else if (limitKey === 'max_users') {
      // Count users in organization
      const result = await dbClient`
        SELECT COUNT(*) as count FROM "User" 
        WHERE "organizationId" = ${organizationId} 
        AND "deletedAt" IS NULL
      `;
      currentUsage = result[0]?.count ?? 0;
    } else if (limitKey === 'max_inventory_items') {
      // Count inventory items
      const result = await dbClient`
        SELECT COUNT(*) as count FROM "InventoryItem" 
        WHERE "organizationId" = ${organizationId} 
        AND "deletedAt" IS NULL
      `;
      currentUsage = result[0]?.count ?? 0;
    } else if (limitKey === 'storage_bytes') {
      // Sum storage usage from uploads
      const result = await dbClient`
        SELECT COALESCE(SUM("fileSizeBytes"), 0) as total FROM "Upload" 
        WHERE "organizationId" = ${organizationId}
      `;
      currentUsage = result[0]?.total ?? 0;
    }
    const isWithinLimit = currentUsage < limit;
    const percentageUsed = limit > 0 ? Math.round((currentUsage / limit) * 100) : 0;

    return {
      isWithinLimit,
      currentUsage,
      limit,
      percentageUsed,
      error: !isWithinLimit
        ? `Usage limit exceeded: ${currentUsage}/${limit} ${limitKey}`
        : undefined,
    };
  } catch (error) {
    console.error('[FeatureGate] Error checking usage limit:', error);
    return {
      isWithinLimit: false,
      currentUsage: 0,
      limit,
      percentageUsed: 0,
      error: `Failed to check ${limitKey} limit`,
    };
  }
}

/**
 * Task 8B.2.3: Create middleware factory for feature gate enforcement
 * Returns a middleware function that checks feature access before proceeding
 *
 * @param featureKey - Feature to gate
 * @returns Middleware function
 */
export function requireFeatureAccess(featureKey: FeatureKey) {
  return (tierLevel: TierLevel): { allowed: boolean; error?: string } => {
    const check = checkFeatureAccess(tierLevel, featureKey);
    return {
      allowed: check.isEnabled,
      error: check.error,
    };
  };
}

/**
 * Task 8B.2.4: Create middleware factory for usage limit enforcement
 * Returns a middleware function that checks usage before allowing resource creation
 *
 * @param limitKey - Limit to check
 * @returns Async middleware function
 */
export function enforceUsageLimit(limitKey: LimitKey) {
  return async (
    organizationId: string,
    tierLevel: TierLevel,
    dbClient: any,
  ): Promise<{ allowed: boolean; error?: string; result?: UsageLimitResult }> => {
    const check = await checkUsageLimit(organizationId, limitKey, tierLevel, dbClient);
    return {
      allowed: check.isWithinLimit,
      error: check.error,
      result: check,
    };
  };
}

/**
 * Task 8B.2.5: Helper to format feature gate error with upgrade CTA
 *
 * @param featureKey - Feature that failed
 * @param currentTier - Current tier level
 * @returns Error message with upgrade CTA
 */
export function formatFeatureUpgradeCTA(featureKey: FeatureKey, currentTier: TierLevel): string {
  const upgradePaths: Record<TierLevel, string> = {
    free: 'Upgrade to Starter for larger catalogue limits.',
    starter: 'Upgrade to Professional for advanced features.',
    professional: 'Contact us for Enterprise features.',
    enterprise: 'You have Enterprise access. Contact support for contract changes.',
    premium: 'Contact us for Enterprise features.',
    concierge: 'You have Enterprise access. Contact support for contract changes.',
  };

  return `Feature '${featureKey}' is not available in ${currentTier} tier. ${upgradePaths[currentTier]}`;
}

/**
 * Task 8B.2.5: Helper to format usage limit error with upgrade CTA
 *
 * @param limitKey - Limit that was exceeded
 * @param currentUsage - Current usage count
 * @param limit - Limit for tier
 * @param currentTier - Current tier
 * @returns Error message with upgrade CTA
 */
export function formatUsageLimitCTA(
  limitKey: LimitKey,
  currentUsage: number,
  limit: number,
  currentTier: TierLevel,
): string {
  const tierUpgradeMap: Record<TierLevel, string> = {
    free: 'Upgrade to Starter',
    starter: 'Upgrade to Professional',
    professional: 'Upgrade to Enterprise',
    enterprise: 'Contact support',
    premium: 'Upgrade to Enterprise',
    concierge: 'Contact support',
  };

  return `${limitKey} limit reached (${currentUsage}/${limit}). ${tierUpgradeMap[currentTier]} for more.`;
}
