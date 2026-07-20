const test = require('node:test');
const assert = require('node:assert/strict');
const { validateStripeDeploymentConfig } = require('./validate-stripe-deployment-config');

const validConfig = {
  STRIPE_SECRET_KEY: 'sk_test_example',
  STRIPE_STARTER_MONTHLY_PRICE_ID: 'price_starter_monthly',
  STRIPE_STARTER_ANNUAL_PRICE_ID: 'price_starter_annual',
  STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID: 'price_professional_monthly',
  STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID: 'price_professional_annual',
};

test('accepts four unique Stripe test launch prices', () => {
  assert.deepEqual(validateStripeDeploymentConfig(validConfig), []);
});

test('rejects missing, placeholder, malformed, and duplicate price values', () => {
  const errors = validateStripeDeploymentConfig({
    ...validConfig,
    STRIPE_STARTER_MONTHLY_PRICE_ID: 'fill',
    STRIPE_STARTER_ANNUAL_PRICE_ID: '',
    STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID: 'prod_not_a_price',
    STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID: 'prod_not_a_price',
  });

  assert.match(errors.join('\n'), /STRIPE_STARTER_MONTHLY_PRICE_ID.*placeholder/i);
  assert.match(errors.join('\n'), /STRIPE_STARTER_ANNUAL_PRICE_ID.*required/i);
  assert.match(errors.join('\n'), /STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID.*price_/i);
  assert.match(errors.join('\n'), /duplicate/i);
});

test('requires Stripe test mode during the pre-launch rollout', () => {
  const errors = validateStripeDeploymentConfig({
    ...validConfig,
    STRIPE_SECRET_KEY: 'sk_live_example',
  });

  assert.match(errors.join('\n'), /STRIPE_SECRET_KEY.*sk_test_/i);
});
