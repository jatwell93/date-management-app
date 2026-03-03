/**
 * Default limit values for subscription tiers
 * Used when no specific limit is set or as fallback values
 */

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
  const fallbackValue = DEFAULT_LIMITS[fallback];
  // Allow null values for unlimited tiers (Premium, Concierge)
  if (fallbackValue === null && !fallback.includes('UNLIMITED')) {
    throw new Error(`Fallback default ${fallback} cannot be null`);
  }
  return value ?? fallbackValue;
}
