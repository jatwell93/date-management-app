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
 * All tier levels that must have complete feature flag configurations
 */
export const REQUIRED_TIERS = ['starter', 'professional', 'premium', 'concierge'] as const;

/**
 * Expected limit values for specific features per tier
 * Used for validation warnings (not strict enforcement to allow flexibility)
 */
export const EXPECTED_LIMITS: Record<string, Record<string, number | null>> = {
  starter: {
    max_skus: 500,
    max_users: 1,
    max_inventory_items: 5000,
  },
  professional: {
    max_skus: 2000,
    max_users: 3,
    max_inventory_items: 20000,
  },
  premium: {
    max_skus: null,
    max_users: 10,
    max_inventory_items: null,
  },
  concierge: {
    max_skus: null,
    max_users: 10,
    max_inventory_items: null,
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

function getDefaultTierFeatureConfig(
  tier: (typeof REQUIRED_TIERS)[number],
  feature: (typeof REQUIRED_FEATURES)[number],
): { enabled: boolean; limitValue: number | null } {
  const limitValue = EXPECTED_LIMITS[tier]?.[feature] ?? null;
  const enabled = feature.startsWith('max_') || tier !== 'starter';
  return { enabled, limitValue };
}

/**
 * Validates that all required tier feature flags exist in the database
 * This is a critical check that should run at application startup
 *
 * @param prisma - PrismaClient instance
 * @returns ValidationResult with detailed status
 */
export async function validateTierFeatureFlags(prisma: PrismaClient): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missingFeatures: string[] = [];
  const flagCounts: Record<string, number> = {};

  Logger.info('Starting tier feature flags validation...');

  // Check each required tier
  for (const tier of REQUIRED_TIERS) {
    let tierFlagCount = 0;

    for (const feature of REQUIRED_FEATURES) {
      const flag = await prisma.tierFeatureFlag.findUnique({
        where: {
          tierLevel_featureKey: {
            tierLevel: tier,
            featureKey: feature,
          },
        },
      });

      if (!flag) {
        const missingKey = `${tier}.${feature}`;
        missingFeatures.push(missingKey);
        errors.push(`Missing feature flag: ${missingKey}`);
      } else {
        tierFlagCount++;

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
    }

    flagCounts[tier] = tierFlagCount;
  }

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
 * @param prisma - PrismaClient instance
 * @returns true if all required flags exist, false otherwise
 */
export async function quickValidateTierFeatureFlags(prisma: PrismaClient): Promise<boolean> {
  try {
    // Count total feature flags
    const totalFlags = await prisma.tierFeatureFlag.count();
    const requiredCount = REQUIRED_TIERS.length * REQUIRED_FEATURES.length;

    if (totalFlags < requiredCount) {
      return false;
    }

    // Quick check - just verify one critical flag per tier exists
    for (const tier of REQUIRED_TIERS) {
      const flag = await prisma.tierFeatureFlag.findUnique({
        where: {
          tierLevel_featureKey: {
            tierLevel: tier,
            featureKey: 'max_skus',
          },
        },
      });

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
 * @param prisma - PrismaClient instance
 * @returns Result of seeding operation
 */
export async function seedMissingTierFeatureFlags(
  prisma: PrismaClient,
): Promise<{ seeded: string[]; errors: string[] }> {
  const seeded: string[] = [];
  const errors: string[] = [];

  Logger.info('Starting to seed missing tier feature flags...');

  for (const tier of REQUIRED_TIERS) {
    for (const feature of REQUIRED_FEATURES) {
      try {
        const existing = await prisma.tierFeatureFlag.findUnique({
          where: {
            tierLevel_featureKey: {
              tierLevel: tier,
              featureKey: feature,
            },
          },
          select: { id: true },
        });

        const { enabled, limitValue } = getDefaultTierFeatureConfig(tier, feature);

        await prisma.tierFeatureFlag.upsert({
          where: {
            tierLevel_featureKey: {
              tierLevel: tier,
              featureKey: feature,
            },
          },
          update: {},
          create: {
            tierLevel: tier,
            featureKey: feature,
            enabled,
            limitValue,
          },
        });

        if (!existing) {
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
