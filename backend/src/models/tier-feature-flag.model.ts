/**
 * Tier feature flag data model
 * Controls which features are available at each subscription tier
 */

import { TierLevel, FeatureKey } from '../types/subscription';

export interface TierFeatureFlag {
  id: number;
  tierLevel: TierLevel;
  featureKey: FeatureKey;
  enabled: boolean;
  limitValue?: number; // For features like max_skus, max_users
}

export interface CreateTierFeatureFlagInput {
  tierLevel: TierLevel;
  featureKey: FeatureKey;
  enabled?: boolean;
  limitValue?: number;
}

/**
 * Helper interface for checking feature availability
 */
export interface FeatureCheckResult {
  available: boolean;
  enabled: boolean;
  limitValue?: number;
  message?: string;
}
