import { useMemo } from 'react';
import type { TierLevel } from '../types/subscription';

type FeatureKey =
  | 'advanced_analytics'
  | 'api_access'
  | 'priority_support'
  | 'dedicated_support'
  | 'custom_integrations';

const TIER_FEATURES: Record<TierLevel, FeatureKey[]> = {
  starter: [],
  professional: ['api_access'],
  premium: ['advanced_analytics', 'api_access', 'priority_support'],
  concierge: [
    'advanced_analytics',
    'api_access',
    'priority_support',
    'dedicated_support',
    'custom_integrations',
  ],
};

export function useFeatureGate(feature: FeatureKey, tierLevel?: TierLevel) {
  const hasFeature = useMemo(() => {
    if (!tierLevel) return false;
    return TIER_FEATURES[tierLevel].includes(feature);
  }, [feature, tierLevel]);

  return {
    hasFeature,
    showUpgradePrompt: !hasFeature,
  };
}
