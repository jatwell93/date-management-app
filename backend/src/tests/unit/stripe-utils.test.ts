import Stripe from 'stripe';
import { envConfig } from '../../config/environment';
import { getStripeClient, isStripeConfigured, resetStripeClient } from '../../utils/stripe';

jest.mock('stripe', () => {
  return jest.fn().mockImplementation((secretKey: string, options: unknown) => ({
    secretKey,
    options,
  }));
});

describe('stripe utils', () => {
  const originalStripeSecret = envConfig.STRIPE_SECRET_KEY;

  beforeEach(() => {
    resetStripeClient();
    envConfig.STRIPE_SECRET_KEY = 'sk_test_abcdefghijklmnopqrstuvwxyz';
    jest.clearAllMocks();
  });

  afterAll(() => {
    envConfig.STRIPE_SECRET_KEY = originalStripeSecret;
    resetStripeClient();
  });

  it('creates and returns a singleton Stripe client', () => {
    const first = getStripeClient();
    const second = getStripeClient();

    expect(first).toBe(second);
    expect(Stripe).toHaveBeenCalledTimes(1);
  });

  it('throws when STRIPE_SECRET_KEY is missing', () => {
    envConfig.STRIPE_SECRET_KEY = undefined;

    expect(() => getStripeClient()).toThrow(
      'STRIPE_SECRET_KEY is not configured. Please set it in your environment variables.',
    );
  });

  it('throws when STRIPE_SECRET_KEY does not look like a secret key', () => {
    envConfig.STRIPE_SECRET_KEY = 'pk_test_public_key';

    expect(() => getStripeClient()).toThrow(
      'STRIPE_SECRET_KEY appears to be invalid. It should start with "sk_".',
    );
  });

  it('reports Stripe configuration status accurately', () => {
    envConfig.STRIPE_SECRET_KEY = 'sk_test_configured';
    expect(isStripeConfigured()).toBe(true);

    envConfig.STRIPE_SECRET_KEY = 'pk_test_not_secret';
    expect(isStripeConfigured()).toBe(false);

    envConfig.STRIPE_SECRET_KEY = undefined;
    expect(isStripeConfigured()).toBe(false);
  });

  it('creates a fresh client after reset', () => {
    const first = getStripeClient();
    resetStripeClient();
    const second = getStripeClient();

    expect(first).not.toBe(second);
    expect(Stripe).toHaveBeenCalledTimes(2);
  });
});
