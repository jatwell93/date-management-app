'use strict';
/**
 * Subscription tier and feature types for multi-tenant SaaS
 * Shared constants between backend and workers
 */
Object.defineProperty(exports, '__esModule', { value: true });
exports.ALERT_THRESHOLDS =
  exports.PROFESSIONAL_TRIAL_DAYS =
  exports.TIER_ANNUAL_PRICES =
  exports.TIER_PRICES =
  exports.TIER_LIMITS =
  exports.AVAILABLE_FEATURES =
  exports.BillingCycle =
  exports.SubscriptionStatus =
    void 0;
exports.validateAlertThresholds = validateAlertThresholds;
var SubscriptionStatus;
(function (SubscriptionStatus) {
  SubscriptionStatus['ACTIVE'] = 'active';
  SubscriptionStatus['CANCELED'] = 'canceled';
  SubscriptionStatus['EXPIRED'] = 'expired';
  SubscriptionStatus['PAST_DUE'] = 'past_due';
  SubscriptionStatus['TRIALING'] = 'trialing';
})(SubscriptionStatus || (exports.SubscriptionStatus = SubscriptionStatus = {}));
var BillingCycle;
(function (BillingCycle) {
  BillingCycle['MONTHLY'] = 'monthly';
  BillingCycle['ANNUAL'] = 'annual';
})(BillingCycle || (exports.BillingCycle = BillingCycle = {}));
/**
 * Feature flag keys available for tier-based gating
 */
exports.AVAILABLE_FEATURES = {
  MAX_SKUS: 'max_skus',
  MAX_USERS: 'max_users',
  ADVANCED_ANALYTICS: 'advanced_analytics',
  API_ACCESS: 'api_access',
  PRIORITY_SUPPORT: 'priority_support',
  DEDICATED_SUPPORT: 'dedicated_support',
  CUSTOM_INTEGRATIONS: 'custom_integrations',
};
/**
 * Tier configuration with default limits
 * Single source of truth for both backend and workers
 */
exports.TIER_LIMITS = {
  free: {
    max_skus: 500,
    max_users: 1,
    max_inventory_items: 500,
    storage_bytes: 1073741824,
  },
  starter: {
    max_skus: 5000,
    max_users: 3,
    max_inventory_items: 5000,
    storage_bytes: 10737418240,
  },
  professional: {
    max_skus: 50000,
    max_users: 10,
    max_inventory_items: 50000,
    storage_bytes: 107374182400,
  },
  enterprise: {
    max_skus: 250000,
    max_users: 10,
    max_inventory_items: 250000,
    storage_bytes: 107374182400,
  },
  premium: {
    max_skus: 50000,
    max_users: 10,
    max_inventory_items: 50000,
    storage_bytes: 107374182400,
  },
  concierge: {
    max_skus: 250000,
    max_users: 10,
    max_inventory_items: 250000,
    storage_bytes: 107374182400,
  },
};
/**
 * Standard pricing in cents for MRR calculations
 */
exports.TIER_PRICES = {
  free: 0,
  starter: 3900,
  professional: 9900,
  enterprise: 0,
  premium: 9900,
  concierge: 0,
};
exports.TIER_ANNUAL_PRICES = {
  free: 0,
  starter: 39000,
  professional: 99000,
  enterprise: 0,
  premium: 99000,
  concierge: 0,
};
exports.PROFESSIONAL_TRIAL_DAYS = 14;
/**
 * Default alert thresholds for metrics
 */
exports.ALERT_THRESHOLDS = {
  trialConversionRateMin: 10, // 10%
  webhookFailureRateMax: 5, // 5%
  paymentFailureRateMax: 2, // 2%
  churnRateMax: 5, // 5%
};
/**
 * Validate alert thresholds are within acceptable ranges
 */
function validateAlertThresholds(thresholds) {
  const validated = { ...exports.ALERT_THRESHOLDS, ...thresholds };
  // Validate percentage thresholds are between 0 and 100
  if (validated.trialConversionRateMin < 0 || validated.trialConversionRateMin > 100) {
    throw new Error(
      `trialConversionRateMin must be between 0 and 100, got ${validated.trialConversionRateMin}`,
    );
  }
  if (validated.webhookFailureRateMax < 0 || validated.webhookFailureRateMax > 100) {
    throw new Error(
      `webhookFailureRateMax must be between 0 and 100, got ${validated.webhookFailureRateMax}`,
    );
  }
  if (validated.paymentFailureRateMax < 0 || validated.paymentFailureRateMax > 100) {
    throw new Error(
      `paymentFailureRateMax must be between 0 and 100, got ${validated.paymentFailureRateMax}`,
    );
  }
  if (validated.churnRateMax < 0 || validated.churnRateMax > 100) {
    throw new Error(`churnRateMax must be between 0 and 100, got ${validated.churnRateMax}`);
  }
  return validated;
}
