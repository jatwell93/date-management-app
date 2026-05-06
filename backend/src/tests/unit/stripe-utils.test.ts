function loadStripeUtils() {
  jest.resetModules();

  const StripeConstructor = jest.fn().mockImplementation((secretKey: string, options: unknown) => ({
    secretKey,
    options,
  }));

  jest.doMock('stripe', () => StripeConstructor);

  const { envConfig } =
    require('../../config/environment') as typeof import('../../config/environment');
  const stripeUtils = require('../../utils/stripe') as typeof import('../../utils/stripe');

  return {
    StripeConstructor,
    envConfig,
    ...stripeUtils,
  };
}

describe('stripe utils', () => {
  afterEach(() => {
    jest.dontMock('stripe');
  });

  it('creates and returns a singleton Stripe client', () => {
    const { StripeConstructor, envConfig, getStripeClient } = loadStripeUtils();
    envConfig.STRIPE_SECRET_KEY = 'sk_test_abcdefghijklmnopqrstuvwxyz';

    const first = getStripeClient();
    const second = getStripeClient();

    expect(first).toBe(second);
    expect(StripeConstructor).toHaveBeenCalledTimes(1);
  });

  it('throws when STRIPE_SECRET_KEY is missing', () => {
    const { envConfig, getStripeClient } = loadStripeUtils();
    envConfig.STRIPE_SECRET_KEY = undefined;

    expect(() => getStripeClient()).toThrow(
      'STRIPE_SECRET_KEY is not configured. Please set it in your environment variables.',
    );
  });

  it('throws when STRIPE_SECRET_KEY does not look like a secret key', () => {
    const { envConfig, getStripeClient } = loadStripeUtils();
    envConfig.STRIPE_SECRET_KEY = 'pk_test_public_key';

    expect(() => getStripeClient()).toThrow(
      'STRIPE_SECRET_KEY appears to be invalid. It should start with "sk_".',
    );
  });

  it('reports Stripe configuration status accurately', () => {
    const { envConfig, isStripeConfigured } = loadStripeUtils();

    envConfig.STRIPE_SECRET_KEY = 'sk_test_configured';
    expect(isStripeConfigured()).toBe(true);

    envConfig.STRIPE_SECRET_KEY = 'pk_test_not_secret';
    expect(isStripeConfigured()).toBe(false);

    envConfig.STRIPE_SECRET_KEY = undefined;
    expect(isStripeConfigured()).toBe(false);
  });

  it('creates a fresh client after reset', () => {
    const { StripeConstructor, envConfig, getStripeClient, resetStripeClient } = loadStripeUtils();
    envConfig.STRIPE_SECRET_KEY = 'sk_test_abcdefghijklmnopqrstuvwxyz';

    const first = getStripeClient();
    resetStripeClient();
    const second = getStripeClient();

    expect(first).not.toBe(second);
    expect(StripeConstructor).toHaveBeenCalledTimes(2);
  });
});
