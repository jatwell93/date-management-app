import { PrismaClient } from '@prisma/client';
import { Logger } from './logger';

/**
 * Required feature flags for each tier level
 * These must exist in the tier_feature_flags table for the application to function correctly
 */
export const REQUIRED_FEATURES = [
  'max_skus',
  'max_users',
  'max_inventory_items',
  'advanced_analytics',
  'api_access',
  'priority_support',
  'dedicated_support',
  'custom_integrations',
] as const;

/**
 * All tier levels that must have complete feature flag configurations.
 *
 * `free`/`starter`/`professional`/`enterprise` are the launch tiers.
 * `premium`/`concierge` are LEGACY tiers retained only as a migration bridge for
 * existing records; they normalize to professional/enterprise. Do not assign new
 * customers to them.
 */
export const REQUIRED_TIERS = [
  'free',
  'starter',
  'professional',
  'enterprise',
  // Legacy (transitional) — see note above.
  'premium',
  'concierge',
] as const;

/**
 * Expected limit values for specific features per tier
 * Used for validation warnings (not strict enforcement to allow flexibility)
 */
export const EXPECTED_LIMITS: Record<string, Record<string, number | null>> = {
  free: {
    max_skus: 500,
    max_users: 1,
    max_inventory_items: 500,
  },
  starter: {
    max_skus: 5000,
    max_users: 3,
    max_inventory_items: 5000,
  },
  professional: {
    max_skus: 50000,
    max_users: 10,
    max_inventory_items: 50000,
  },
  premium: {
    max_skus: 50000,
    max_users: 10,
    max_inventory_items: 50000,
  },
  concierge: {
    max_skus: 250000,
    max_users: 10,
    max_inventory_items: 250000,
  },
  enterprise: {
    max_skus: 250000,
    max_users: 10,
    max_inventory_items: 250000,
  },
};

/**
 * Result of tier feature flag validation
 */
export interface ValidationResult {
  valid: boolean;
  missingFeatures: string[];
  errors: string[];
  warnings: string[];
  flagCounts: Record<string, number>;
}

type Tier = (typeof REQUIRED_TIERS)[number];
type Feature = (typeof REQUIRED_FEATURES)[number];

interface TierFeatureFlagStore {
  findTierFeatureFlag(
    tierLevel: Tier,
    featureKey: Feature,
  ): Promise<{ limitValue?: number | null } | null>;
  countTierFeatureFlags(): Promise<number>;
  seedTierFeatureFlag(params: {
    tierLevel: Tier;
    featureKey: Feature;
    enabled: boolean;
    limitValue: number | null;
  }): Promise<{ seeded: boolean }>;
}

type TierFeatureFlagSource = PrismaClient | TierFeatureFlagStore;

function createTierFeatureFlagStore(source: TierFeatureFlagSource): TierFeatureFlagStore {
  if ('findTierFeatureFlag' in source) {
    return source;
  }

  return {
    findTierFeatureFlag: (tierLevel, featureKey) =>
      source.tierFeatureFlag.findUnique({
        where: {
          tierLevel_featureKey: {
            tierLevel,
            featureKey,
          },
        },
      }),
    countTierFeatureFlags: () => source.tierFeatureFlag.count(),
    seedTierFeatureFlag: async ({ tierLevel, featureKey, enabled, limitValue }) => {
      const existing = await source.tierFeatureFlag.findUnique({
        where: {
          tierLevel_featureKey: {
            tierLevel,
            featureKey,
          },
        },
        select: { id: true },
      });

      await source.tierFeatureFlag.upsert({
        where: {
          tierLevel_featureKey: {
            tierLevel,
            featureKey,
          },
        },
        update: {},
        create: {
          tierLevel,
          featureKey,
          enabled,
          limitValue,
        },
      });

      return { seeded: !existing };
    },
  };
}

function getDefaultTierFeatureConfig(
  tier: Tier,
  feature: Feature,
): { enabled: boolean; limitValue: number | null } {
  const limitValue = EXPECTED_LIMITS[tier]?.[feature] ?? null;
  const enabled = feature.startsWith('max_') || tier !== 'free';
  return { enabled, limitValue };
}

/**
 * Validates that all required tier feature flags exist in the database
 * This is a critical check that should run at application startup
 *
 * @param source - PrismaClient or repository providing tier feature flag access
 * @returns ValidationResult with detailed status
 */
export async function validateTierFeatureFlags(
  source: TierFeatureFlagSource,
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missingFeatures: string[] = [];
  const flagCounts: Record<string, number> = {};
  const tierFeatureFlags = createTierFeatureFlagStore(source);

  Logger.info('Starting tier feature flags validation...');

  // Fetch all (tier × feature) flags in parallel
  const pairs = REQUIRED_TIERS.flatMap((tier) =>
    REQUIRED_FEATURES.map((feature) => ({ tier, feature })),
  );
  const flags = await Promise.all(
    pairs.map(({ tier, feature }) => tierFeatureFlags.findTierFeatureFlag(tier, feature)),
  );

  for (const tier of REQUIRED_TIERS) {
    flagCounts[tier] = 0;
  }

  pairs.forEach(({ tier, feature }, i) => {
    const flag = flags[i];
    if (!flag) {
      const missingKey = `${tier}.${feature}`;
      missingFeatures.push(missingKey);
      errors.push(`Missing feature flag: ${missingKey}`);
    } else {
      flagCounts[tier]++;

      // Validate limit values match expected (warn, don't error - allows flexibility)
      if (flag.limitValue !== undefined && feature in (EXPECTED_LIMITS[tier] || {})) {
        const expectedLimit = EXPECTED_LIMITS[tier][feature];
        if (flag.limitValue !== expectedLimit) {
          warnings.push(
            `Feature flag ${tier}.${feature} has limitValue=${flag.limitValue}, expected ${expectedLimit}`,
          );
        }
      }
    }
  });

  // Log summary
  Logger.info('Tier feature flags validation summary:', {
    tiers: REQUIRED_TIERS,
    flagCounts,
    totalRequired: REQUIRED_TIERS.length * REQUIRED_FEATURES.length,
    totalFound: REQUIRED_TIERS.length * REQUIRED_FEATURES.length - missingFeatures.length,
    missingCount: missingFeatures.length,
  });

  if (errors.length > 0) {
    Logger.error('Tier feature flags validation FAILED', {
      errorCount: errors.length,
      warningCount: warnings.length,
      missingFeatures,
      errors,
    });

    return {
      valid: false,
      missingFeatures,
      errors,
      warnings,
      flagCounts,
    };
  }

  if (warnings.length > 0) {
    Logger.warn('Tier feature flags validation passed with warnings', {
      warningCount: warnings.length,
      warnings,
    });
  }

  Logger.info('Tier feature flags validation PASSED');

  return {
    valid: true,
    missingFeatures: [],
    errors: [],
    warnings,
    flagCounts,
  };
}

/**
 * Quick validation that can be used for health checks
 * Returns boolean only - faster than full validation
 *
 * @param source - PrismaClient or repository providing tier feature flag access
 * @returns true if all required flags exist, false otherwise
 */
export async function quickValidateTierFeatureFlags(
  source: TierFeatureFlagSource,
): Promise<boolean> {
  const tierFeatureFlags = createTierFeatureFlagStore(source);

  try {
    // Count total feature flags
    const totalFlags = await tierFeatureFlags.countTierFeatureFlags();
    const requiredCount = REQUIRED_TIERS.length * REQUIRED_FEATURES.length;

    if (totalFlags < requiredCount) {
      return false;
    }

    // Quick check - just verify one critical flag per tier exists
    for (const tier of REQUIRED_TIERS) {
      const flag = await tierFeatureFlags.findTierFeatureFlag(tier, 'max_skus');

      if (!flag) {
        return false;
      }
    }

    return true;
  } catch (error) {
    Logger.error('Error during quick tier flag validation', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

/**
 * Seeds missing tier feature flags with default values
 * Use with caution - should be run manually, not automatically
 *
 * @param source - PrismaClient or repository providing tier feature flag access
 * @returns Result of seeding operation
 */
export async function seedMissingTierFeatureFlags(
  source: TierFeatureFlagSource,
): Promise<{ seeded: string[]; errors: string[] }> {
  const seeded: string[] = [];
  const errors: string[] = [];
  const tierFeatureFlags = createTierFeatureFlagStore(source);

  Logger.info('Starting to seed missing tier feature flags...');

  for (const tier of REQUIRED_TIERS) {
    for (const feature of REQUIRED_FEATURES) {
      try {
        const { enabled, limitValue } = getDefaultTierFeatureConfig(tier, feature);

        const result = await tierFeatureFlags.seedTierFeatureFlag({
          tierLevel: tier,
          featureKey: feature,
          enabled,
          limitValue,
        });

        if (result.seeded) {
          seeded.push(`${tier}.${feature}`);
          Logger.info(`Seeded feature flag: ${tier}.${feature}`, { enabled, limitValue });
        }
      } catch (error) {
        // Concurrent runs may race on the same unique (tierLevel, featureKey) key.
        // If another transaction inserted first, treat that as a successful no-op.
        const prismaError = error as { code?: string; message?: string };
        if (
          prismaError.code === 'P2002' ||
          prismaError.message?.includes('Unique constraint failed')
        ) {
          continue;
        }

        const errorMsg = `Failed to seed ${tier}.${feature}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errors.push(errorMsg);
        Logger.error(errorMsg);
      }
    }
  }

  Logger.info('Completed seeding tier feature flags', {
    seededCount: seeded.length,
    errorCount: errors.length,
  });

  return { seeded, errors };
}
