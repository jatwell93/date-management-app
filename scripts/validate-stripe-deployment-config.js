const REQUIRED_PRICE_KEYS = [
  'STRIPE_STARTER_MONTHLY_PRICE_ID',
  'STRIPE_STARTER_ANNUAL_PRICE_ID',
  'STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID',
  'STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID',
];

const PLACEHOLDER_VALUES = new Set(['fill', 'replace_me', 'price_replace_me']);

function validateStripeDeploymentConfig(config) {
  const errors = [];
  const prices = [];

  for (const key of REQUIRED_PRICE_KEYS) {
    const value = config[key]?.trim() || '';

    if (!value) {
      errors.push(`${key} is required`);
      continue;
    }

    if (PLACEHOLDER_VALUES.has(value.toLowerCase())) {
      errors.push(`${key} contains a placeholder value`);
      continue;
    }

    if (!value.startsWith('price_')) {
      errors.push(`${key} must start with price_`);
    }

    prices.push({ key, value });
  }

  const duplicateValues = prices
    .filter(({ value }, index) => prices.findIndex((price) => price.value === value) !== index)
    .map(({ value }) => value);

  if (duplicateValues.length > 0) {
    errors.push(`Stripe launch price IDs must be unique; duplicate: ${duplicateValues[0]}`);
  }

  const secretKey = config.STRIPE_SECRET_KEY?.trim() || '';
  if (!secretKey.startsWith('sk_test_')) {
    errors.push('STRIPE_SECRET_KEY must use sk_test_ during the pre-launch test-mode rollout');
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
