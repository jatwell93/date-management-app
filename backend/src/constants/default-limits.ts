/**
 * Default limit values for subscription tiers
 * Used when no specific limit is set or as fallback values
 */

import { Logger } from '../utils/logger';

export const DEFAULT_LIMITS = {
  // When a tier has unlimited (null) limit, use these large numbers
  UNLIMITED_SKUS: 999999,
  UNLIMITED_USERS: 999999,
  UNLIMITED_INVENTORY_ITEMS: 999999,
  UNLIMITED_STORAGE_BYTES: 999999999999, // ~1TB

  // Starter tier defaults (used when creating OrganizationUsage)
  STARTER_MAX_SKUS: 500,
  STARTER_MAX_USERS: 1,
  STARTER_MAX_INVENTORY_ITEMS: 5000,
  STARTER_STORAGE_BYTES: 1073741824, // 1GB

  // Professional tier defaults
  PROFESSIONAL_MAX_SKUS: 2000,
  PROFESSIONAL_MAX_USERS: 3,
  PROFESSIONAL_MAX_INVENTORY_ITEMS: 20000,
  PROFESSIONAL_STORAGE_BYTES: 10737418240, // 10GB

  // Premium tier defaults
  PREMIUM_MAX_SKUS: null, // unlimited
  PREMIUM_MAX_USERS: 10,
  PREMIUM_MAX_INVENTORY_ITEMS: null, // unlimited
  PREMIUM_STORAGE_BYTES: 107374182400, // 100GB

  // Concierge tier defaults
  CONCIERGE_MAX_SKUS: null, // unlimited
  CONCIERGE_MAX_USERS: 10,
  CONCIERGE_MAX_INVENTORY_ITEMS: null, // unlimited
  CONCIERGE_STORAGE_BYTES: null, // unlimited
} as const;

/**
 * Helper function to get the appropriate default value for a limit
 */
export function getDefaultValue(limitType: keyof typeof DEFAULT_LIMITS): number | null {
  return DEFAULT_LIMITS[limitType];
}

/**
 * Helper function to resolve unlimited (null) values to large numbers
 * for calculations that require numeric values
 */
export function resolveUnlimitedLimit(
  value: number | null,
  fallback: keyof typeof DEFAULT_LIMITS,
): number {
  // UNLIMITED_* keys are always numbers - use them directly as fallback
  if (fallback.includes('UNLIMITED')) {
    const fallbackValue = DEFAULT_LIMITS[fallback];
    // Type assertion: UNLIMITED_* values are guaranteed to be numbers
    return value ?? (fallbackValue as number);
  }

  // For tier defaults (*_MAX_*), null is valid (represents unlimited)
  // If value is provided, use it; otherwise use appropriate unlimited fallback
  if (value !== null) {
    return value;
  }

  // value is null and fallback is a tier default (unlimited tier)
  // Map to appropriate UNLIMITED_* fallback instead of throwing
  const limitType = fallback.split('_MAX_')[1]; // e.g., "SKUS" from "STARTER_MAX_SKUS"
  if (limitType) {
    const unlimitedKey = `UNLIMITED_${limitType}` as keyof typeof DEFAULT_LIMITS;
    const unlimitedValue = DEFAULT_LIMITS[unlimitedKey];
    if (typeof unlimitedValue === 'number') {
      Logger.warn(`Unlimited limit detected for ${fallback}, using ${unlimitedKey} fallback`);
      return unlimitedValue;
    }
  }

  // Final fallback - should never reach here with proper configuration
  Logger.error(`Cannot resolve unlimited limit: no fallback available for ${fallback}`);
  return Number.MAX_SAFE_INTEGER;
}
