import { TIER_LIMITS, TierLevel } from '../types/subscription';

export interface TierLimits {
  max_skus: number | null;
  max_users: number | null;
  max_inventory_items: number | null;
}

export const getTierLimits = (tierLevel: TierLevel): TierLimits => {
  const limits = TIER_LIMITS[tierLevel];

  return {
    max_skus: limits.max_skus ?? null,
    max_users: limits.max_users ?? null,
    max_inventory_items: limits.max_inventory_items ?? null,
  };
};
