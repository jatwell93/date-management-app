// Keep REQUIRED_PRICE_KEYS aligned with STRIPE_PRICE_CATALOG in
// backend/src/services/subscription-billing.helpers.ts.
const REQUIRED_PRICE_KEYS = [
  'STRIPE_STARTER_MONTHLY_PRICE_ID',
  'STRIPE_STARTER_ANNUAL_PRICE_ID',
  'STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID',
  'STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID',
];

const PLACEHOLDER_VALUES = new Set(['fill', 'replace_me', 'price_replace_me']);

function validatePriceKey(key, value) {
  if (!value) {
    return { error: `${key} is required`, comparable: false };
  }

  if (PLACEHOLDER_VALUES.has(value.toLowerCase())) {
    return { error: `${key} contains a placeholder value`, comparable: false };
  }

  if (!value.startsWith('price_')) {
    return { error: `${key} must start with price_`, comparable: true };
  }

  return { error: null, comparable: true };
}

function findDuplicatePriceValue(values) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
  return null;
}

// LAUNCH GATE: when live-mode Stripe is approved, this check must change to
// require sk_live_ (see the launch gate in the add-queued-catalogue-imports
// OpenSpec change). Until then prd intentionally stays on sk_test_.
function validateSecretKeyMode(config) {
  const secretKey = config.STRIPE_SECRET_KEY?.trim() || '';
  if (!secretKey.startsWith('sk_test_')) {
    return 'STRIPE_SECRET_KEY must use sk_test_ during the pre-launch test-mode rollout';
  }
  return null;
}

function validateStripeDeploymentConfig(config) {
  const errors = [];
  const comparableValues = [];

  for (const key of REQUIRED_PRICE_KEYS) {
    const value = config[key]?.trim() || '';
    const { error, comparable } = validatePriceKey(key, value);

    if (error) {
      errors.push(error);
    }
    if (comparable) {
      comparableValues.push(value);
    }
  }

  const duplicateValue = findDuplicatePriceValue(comparableValues);
  if (duplicateValue) {
    errors.push(`Stripe launch price IDs must be unique; duplicate: ${duplicateValue}`);
  }

  const secretKeyError = validateSecretKeyMode(config);
  if (secretKeyError) {
    errors.push(secretKeyError);
  }

  return errors;
}

if (require.main === module) {
  const errors = validateStripeDeploymentConfig(process.env);

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`Stripe deployment configuration error: ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log('Stripe deployment configuration is valid for test-mode launch pricing.');
  }
}

module.exports = { REQUIRED_PRICE_KEYS, validateStripeDeploymentConfig };
