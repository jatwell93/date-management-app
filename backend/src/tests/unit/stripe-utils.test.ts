async function loadStripeUtils() {
  vi.resetModules();

  const StripeConstructor = vi.fn().mockImplementation(function (
    secretKey: string,
    options: unknown,
  ) {
    return {
      secretKey,
      options,
    };
  });

  // Vitest mocking is async; `import` replaces jest's synchronous `require`.
  vi.doMock('stripe', () => ({ default: StripeConstructor }));

  const { envConfig } =
    (await import('../../config/environment')) as typeof import('../../config/environment');
  const stripeUtils = (await import('../../utils/stripe')) as typeof import('../../utils/stripe');

  return {
    StripeConstructor,
    envConfig,
    ...stripeUtils,
  };
}

describe('stripe utils', async () => {
  afterEach(() => {
    vi.doUnmock('stripe');
  });

  it('creates and returns a singleton Stripe client', async () => {
    const { StripeConstructor, envConfig, getStripeClient } = await loadStripeUtils();
    envConfig.STRIPE_SECRET_KEY = 'sk_test_abcdefghijklmnopqrstuvwxyz';

    const first = getStripeClient();
    const second = getStripeClient();

    expect(first).toBe(second);
    expect(StripeConstructor).toHaveBeenCalledTimes(1);
  });

  it('throws when STRIPE_SECRET_KEY is missing', async () => {
    const { envConfig, getStripeClient } = await loadStripeUtils();
    envConfig.STRIPE_SECRET_KEY = undefined;

    expect(() => getStripeClient()).toThrow(
      'STRIPE_SECRET_KEY is not configured. Please set it in your environment variables.',
    );
  });

  it('throws when STRIPE_SECRET_KEY does not look like a secret key', async () => {
    const { envConfig, getStripeClient } = await loadStripeUtils();
    envConfig.STRIPE_SECRET_KEY = 'pk_test_public_key';

    expect(() => getStripeClient()).toThrow(
      'STRIPE_SECRET_KEY appears to be invalid. It should start with "sk_".',
    );
  });

  it('reports Stripe configuration status accurately', async () => {
    const { envConfig, isStripeConfigured } = await loadStripeUtils();

    envConfig.STRIPE_SECRET_KEY = 'sk_test_configured';
    expect(isStripeConfigured()).toBe(true);

    envConfig.STRIPE_SECRET_KEY = 'pk_test_not_secret';
    expect(isStripeConfigured()).toBe(false);

    envConfig.STRIPE_SECRET_KEY = undefined;
    expect(isStripeConfigured()).toBe(false);
  });

  it('creates a fresh client after reset', async () => {
    const { StripeConstructor, envConfig, getStripeClient, resetStripeClient } =
      await loadStripeUtils();
    envConfig.STRIPE_SECRET_KEY = 'sk_test_abcdefghijklmnopqrstuvwxyz';

    const first = getStripeClient();
    resetStripeClient();
    const second = getStripeClient();

    expect(first).not.toBe(second);
    expect(StripeConstructor).toHaveBeenCalledTimes(2);
  });
});
