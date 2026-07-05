import express from 'express';
import request from 'supertest';
import { BillingCycle } from '../../types/subscription';
import { envConfig } from '../../config/environment';

const mockFindUnique = vi.fn();
const mockSubscriptionTierUpdate = vi.fn();
const mockFindLatestByOrganizationId = vi.fn();
const mockGetOrCreateUsage = vi.fn();
const mockConvertTrialToPaid = vi.fn();

const mockStripeCustomersCreate = vi.fn();
const mockStripeCheckoutSessionCreate = vi.fn();
const mockStripeBillingPortalSessionCreate = vi.fn();

const mockValidateRedirectUrl = vi.fn();
const mockValidateStripePriceId = vi.fn();

vi.mock('../../middleware/clerk-auth.middleware', () => ({
  clerkAuth: (req: any, _res: any, next: any) => {
    req.userId = req.get('x-clerk-user-id') || 'user_123';
    next();
  },
}));

vi.mock('../../middleware/rateLimiter', () => ({
  trialConversionLimiter: (_req: any, _res: any, next: any) => next(),
  checkoutSessionLimiter: (_req: any, _res: any, next: any) => next(),
  standardLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../database/database-factory', () => ({
  getDefaultDatabaseClient: () => ({
    user: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
    subscriptionTier: {
      update: (...args: unknown[]) => mockSubscriptionTierUpdate(...args),
    },
  }),
}));

vi.mock('../../services/subscription.service', () => ({
  SubscriptionService: vi.fn().mockImplementation(function () {
    return {
      convertTrialToPaid: (...args: unknown[]) => mockConvertTrialToPaid(...args),
    };
  }),
}));

vi.mock('../../utils/stripe', () => ({
  getStripeClient: () => ({
    customers: {
      create: (...args: unknown[]) => mockStripeCustomersCreate(...args),
    },
    checkout: {
      sessions: {
        create: (...args: unknown[]) => mockStripeCheckoutSessionCreate(...args),
      },
    },
    billingPortal: {
      sessions: {
        create: (...args: unknown[]) => mockStripeBillingPortalSessionCreate(...args),
      },
    },
  }),
}));

vi.mock('../../utils/url-validator', async () => ({
  StripePriceConfigurationError: (
    await vi.importActual<typeof import('../../utils/url-validator')>('../../utils/url-validator')
  ).StripePriceConfigurationError,
  validateRedirectUrl: (...args: unknown[]) => mockValidateRedirectUrl(...args),
  validateStripePriceId: (...args: unknown[]) => mockValidateStripePriceId(...args),
}));

import subscriptionRouter from '../../routes/subscription.routes';
import organizationRouter from '../../routes/org-bootstrap.routes';

const actualDi = (await vi.importActual(
  '../../di/container',
)) as typeof import('../../di/container');
const actualUserRepository = (await vi.importActual(
  '../../repositories/user.repository',
)) as typeof import('../../repositories/user.repository');
const actualSubscriptionRepository = (await vi.importActual(
  '../../repositories/subscription.repository',
)) as typeof import('../../repositories/subscription.repository');
const actualSubscriptionService = (await vi.importActual(
  '../../services/subscription.service',
)) as typeof import('../../services/subscription.service');
const actualUrlValidator = (await vi.importActual(
  '../../utils/url-validator',
)) as typeof import('../../utils/url-validator');

const configuredStarterMonthlyPriceId = 'price_starter_monthly';
const configuredStarterAnnualPriceId = 'price_starter_annual';
const configuredProfessionalMonthlyPriceId = 'price_professional_monthly';
const configuredProfessionalAnnualPriceId = 'price_professional_annual';
const originalNodeEnv = envConfig.NODE_ENV;
const envKeysChangedBySuite = [
  'FRONTEND_URL',
  'STRIPE_STARTER_MONTHLY_PRICE_ID',
  'STRIPE_STARTER_ANNUAL_PRICE_ID',
  'STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID',
  'STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID',
] as const;

const originalEnvValues = Object.fromEntries(
  envKeysChangedBySuite.map((key) => [key, process.env[key]]),
) as Record<(typeof envKeysChangedBySuite)[number], string | undefined>;

const restoreEnvValue = (key: (typeof envKeysChangedBySuite)[number]) => {
  const originalValue = originalEnvValues[key];

  if (originalValue === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = originalValue;
};

const configureSubscriptionTestEnv = () => {
  envConfig.NODE_ENV = 'test';
  process.env.FRONTEND_URL = 'http://localhost:3000';
  process.env.STRIPE_STARTER_MONTHLY_PRICE_ID = configuredStarterMonthlyPriceId;
  process.env.STRIPE_STARTER_ANNUAL_PRICE_ID = configuredStarterAnnualPriceId;
  process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID = configuredProfessionalMonthlyPriceId;
  process.env.STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID = configuredProfessionalAnnualPriceId;
};

const configureValidatorMocks = () => {
  mockValidateStripePriceId.mockImplementation((priceId: string) =>
    actualUrlValidator.validateStripePriceId(priceId),
  );
  mockValidateRedirectUrl.mockImplementation(() => undefined);
};

const configureRepositoryMocks = () => {
  mockFindUnique.mockResolvedValue({
    organizationId: 'org-1',
    organization: {
      id: 'org-1',
      contactEmail: 'owner@example.com',
      subscriptionTiers: [
        {
          id: 'sub-1',
          status: 'TRIALING',
          tierLevel: 'professional',
          trialEndDate: new Date('2026-04-20T00:00:00.000Z'),
          trialStartedAt: new Date('2026-04-01T00:00:00.000Z'),
          trialConvertedAt: null,
          billingCycle: 'monthly',
          stripeCustomerId: 'cus_existing',
        },
      ],
    },
  });

  mockConvertTrialToPaid.mockResolvedValue({
    id: 'sub-1',
    tierLevel: 'professional',
    status: 'active',
    billingCycle: 'annual',
    trialConvertedAt: new Date('2026-04-11T00:00:00.000Z'),
  });

  mockFindLatestByOrganizationId.mockResolvedValue({
    tierLevel: 'professional',
    status: 'active',
    billingCycle: 'annual',
    trialEndDate: new Date('2026-08-01T00:00:00.000Z'),
  });
  mockGetOrCreateUsage.mockResolvedValue({
    totalSkus: 42,
    activeUsers: 3,
    storageUsedBytes: 4096,
    totalInventoryItems: 84,
  });
};

const configureStripeMocks = () => {
  mockStripeCustomersCreate.mockResolvedValue({ id: 'cus_new' });
  mockSubscriptionTierUpdate.mockResolvedValue({ id: 'sub-1', stripeCustomerId: 'cus_new' });
  mockStripeCheckoutSessionCreate.mockResolvedValue({
    id: 'cs_test_123',
    url: 'https://checkout.stripe.com/c/session_test_123',
  });
  mockStripeBillingPortalSessionCreate.mockResolvedValue({
    url: 'https://billing.stripe.com/session_test_123',
  });
};

const registerTestDependencies = () => {
  const diContainer = actualDi.getDiContainer();

  diContainer.registerInstance(actualUserRepository.UserRepository, {
    findByClerkUserIdWithOrganizationSubscriptions: (...args: unknown[]) => mockFindUnique(...args),
    findOrganizationIdByClerkUserId: (...args: unknown[]) => mockFindUnique(...args),
  } as never);
  diContainer.registerInstance(actualSubscriptionRepository.SubscriptionRepository, {
    updateStripeCustomerId: (id: number, stripeCustomerId: string) =>
      mockSubscriptionTierUpdate({
        where: { id },
        data: { stripeCustomerId },
      }),
    findLatestByOrganizationId: (...args: unknown[]) => mockFindLatestByOrganizationId(...args),
    getOrCreateUsage: (...args: unknown[]) => mockGetOrCreateUsage(...args),
  } as never);
  diContainer.registerInstance(actualSubscriptionService.SubscriptionService, {
    convertTrialToPaid: (...args: unknown[]) => mockConvertTrialToPaid(...args),
  } as never);
  diContainer.registerInstance('StripeClientFactory', () => ({
    customers: {
      create: (...args: unknown[]) => mockStripeCustomersCreate(...args),
    },
    checkout: {
      sessions: {
        create: (...args: unknown[]) => mockStripeCheckoutSessionCreate(...args),
      },
    },
    billingPortal: {
      sessions: {
        create: (...args: unknown[]) => mockStripeBillingPortalSessionCreate(...args),
      },
    },
  }));
};

describe('subscription.routes', () => {
  const app = express();

  app.use(express.json());
  app.use('/subscription', subscriptionRouter);
  app.use('/organization', organizationRouter);
  app.use(
    (
      error: Error & { statusCode?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(error.statusCode ?? 500).json({ error: error.message });
    },
  );

  beforeEach(() => {
    vi.clearAllMocks();

    configureSubscriptionTestEnv();
    configureValidatorMocks();
    configureRepositoryMocks();
    configureStripeMocks();
    registerTestDependencies();
  });

  afterAll(() => {
    envConfig.NODE_ENV = originalNodeEnv;
    envKeysChangedBySuite.forEach(restoreEnvValue);
  });

  const expectAuthenticatedGet = async (path: string, expectedBody: unknown) => {
    const response = await request(app).get(path).set('x-clerk-user-id', 'user_123');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expectedBody);
  };

  describe('GET /subscription/current', () => {
    it('returns the current subscription for the authenticated organization', async () => {
      mockFindUnique.mockResolvedValue({ organizationId: 'org-1' });

      await expectAuthenticatedGet('/subscription/current', {
        tierLevel: 'professional',
        status: 'active',
        billingCycle: 'annual',
        currentPeriodEnd: '2026-08-01T00:00:00.000Z',
      });
      expect(mockFindLatestByOrganizationId).toHaveBeenCalledWith('org-1');
    });
  });

  describe('GET /organization/usage', () => {
    it('returns usage for the authenticated organization', async () => {
      mockFindUnique.mockResolvedValue({ organizationId: 'org-1' });

      await expectAuthenticatedGet('/organization/usage', {
        skus: 42,
        users: 3,
        storage: 4096,
        inventoryItems: 84,
      });
      expect(mockGetOrCreateUsage).toHaveBeenCalledWith('org-1');
    });
  });

  describe('GET /subscription/trial-status', () => {
    it('returns 404 when user or organization is not found', async () => {
      mockFindUnique.mockResolvedValue(null);

      const response = await request(app)
        .get('/subscription/trial-status')
        .set('x-clerk-user-id', 'user_123');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'User or organization not found' });
    });

    it('returns starter limits and null subscription when organization has no subscription', async () => {
      mockFindUnique.mockResolvedValue({
        organization: {
          subscriptionTiers: [],
        },
      });

      const response = await request(app)
        .get('/subscription/trial-status')
        .set('x-clerk-user-id', 'user_123');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        isInTrial: false,
        isTrialExpired: false,
        subscription: null,
        tierLimits: {
          maxUsers: 1,
          maxProducts: 500,
          maxStoreAreas: 3,
          features: ['Basic scanning', 'Expiry tracking', 'Basic reports'],
        },
      });
    });

    it.each(['TRIALING', 'trialing', 'Trialing'])(
      'returns active trial status when DB status is "%s"',
      async (dbStatus) => {
        mockFindUnique.mockResolvedValue({
          organization: {
            subscriptionTiers: [
              {
                status: dbStatus,
                tierLevel: 'professional',
                trialEndDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
                trialStartedAt: new Date('2026-04-01T00:00:00.000Z'),
                trialConvertedAt: null,
                billingCycle: 'monthly',
              },
            ],
          },
        });

        const response = await request(app)
          .get('/subscription/trial-status')
          .set('x-clerk-user-id', 'user_123');

        expect(response.status).toBe(200);
        expect(response.body.isInTrial).toBe(true);
        expect(response.body.isTrialExpired).toBe(false);
        expect(response.body.subscription.status).toBe('trialing');
        expect(response.body.subscription.daysRemaining).toBeGreaterThanOrEqual(1);
      },
    );

    it('returns expired trial status when trial end date is in the past', async () => {
      mockFindUnique.mockResolvedValue({
        organization: {
          subscriptionTiers: [
            {
              status: 'TRIALING',
              tierLevel: 'premium',
              trialEndDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
              trialStartedAt: new Date('2026-03-01T00:00:00.000Z'),
              trialConvertedAt: null,
              billingCycle: 'monthly',
            },
          ],
        },
      });

      const response = await request(app)
        .get('/subscription/trial-status')
        .set('x-clerk-user-id', 'user_123');

      expect(response.status).toBe(200);
      expect(response.body.isInTrial).toBe(false);
      expect(response.body.isTrialExpired).toBe(true);
      expect(response.body.subscription.daysRemaining).toBeLessThan(0);
    });

    it('serializes trialConvertedAt when a conversion timestamp exists', async () => {
      const convertedAt = new Date('2026-04-10T12:00:00.000Z');

      mockFindUnique.mockResolvedValue({
        organization: {
          subscriptionTiers: [
            {
              status: 'ACTIVE',
              tierLevel: 'professional',
              trialEndDate: null,
              trialStartedAt: new Date('2026-04-01T00:00:00.000Z'),
              trialConvertedAt: convertedAt,
              billingCycle: 'annual',
            },
          ],
        },
      });

      const response = await request(app)
        .get('/subscription/trial-status')
        .set('x-clerk-user-id', 'user_123');

      expect(response.status).toBe(200);
      expect(response.body.subscription.trialConvertedAt).toBe(convertedAt.toISOString());
    });

    it('falls back to starter limits and null date fields for unknown tier metadata', async () => {
      mockFindUnique.mockResolvedValue({
        organization: {
          subscriptionTiers: [
            {
              status: 'ACTIVE',
              tierLevel: 'custom-enterprise',
              trialEndDate: null,
              trialStartedAt: null,
              trialConvertedAt: null,
              billingCycle: null,
            },
          ],
        },
      });

      const response = await request(app)
        .get('/subscription/trial-status')
        .set('x-clerk-user-id', 'user_123');

      expect(response.status).toBe(200);
      expect(response.body.subscription).toEqual({
        status: 'active',
        tierLevel: 'custom-enterprise',
        trialEndDate: null,
        trialStartedAt: null,
        trialConvertedAt: null,
        daysRemaining: null,
        billingCycle: null,
      });
      expect(response.body.tierLimits).toEqual({
        maxUsers: 1,
        maxProducts: 500,
        maxStoreAreas: 3,
        features: ['Basic scanning', 'Expiry tracking', 'Basic reports'],
      });
    });

    it('returns 500 when trial-status lookup throws', async () => {
      mockFindUnique.mockRejectedValue(new Error('trial status lookup failed'));

      const response = await request(app)
        .get('/subscription/trial-status')
        .set('x-clerk-user-id', 'user_123');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to fetch trial status' });
    });
  });

  describe('POST /subscription/convert-trial', () => {
    it('returns 400 when paymentMethodId is missing', async () => {
      const response = await request(app)
        .post('/subscription/convert-trial')
        .set('x-clerk-user-id', 'user_123')
        .send({ billingCycle: 'annual' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'paymentMethodId is required' });
      expect(mockConvertTrialToPaid).not.toHaveBeenCalled();
    });

    it('returns 400 when billingCycle is invalid', async () => {
      const response = await request(app)
        .post('/subscription/convert-trial')
        .set('x-clerk-user-id', 'user_123')
        .send({ paymentMethodId: 'pm_123', billingCycle: 'weekly' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'billingCycle must be "monthly" or "annual"' });
      expect(mockConvertTrialToPaid).not.toHaveBeenCalled();
    });

    it('returns 404 when user organization cannot be found', async () => {
      mockFindUnique.mockResolvedValue({ organizationId: null });

      const response = await request(app)
        .post('/subscription/convert-trial')
        .set('x-clerk-user-id', 'user_123')
        .send({ paymentMethodId: 'pm_123', billingCycle: 'annual' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'User organization not found' });
      expect(mockConvertTrialToPaid).not.toHaveBeenCalled();
    });

    it('converts trial to annual paid plan on success', async () => {
      const response = await request(app)
        .post('/subscription/convert-trial')
        .set('x-clerk-user-id', 'user_123')
        .send({ paymentMethodId: 'pm_123', billingCycle: 'annual' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockConvertTrialToPaid).toHaveBeenCalledWith('org-1', 'pm_123', BillingCycle.ANNUAL);
    });

    it('maps monthly billing cycle to BillingCycle.MONTHLY', async () => {
      const response = await request(app)
        .post('/subscription/convert-trial')
        .set('x-clerk-user-id', 'user_123')
        .send({ paymentMethodId: 'pm_123', billingCycle: 'monthly' });

      expect(response.status).toBe(200);
      expect(mockConvertTrialToPaid).toHaveBeenCalledWith('org-1', 'pm_123', BillingCycle.MONTHLY);
    });

    it('uses statusCode from thrown error object when conversion fails', async () => {
      const error = new Error('card declined') as Error & { statusCode?: number };
      error.statusCode = 402;
      mockConvertTrialToPaid.mockRejectedValue(error);

      const response = await request(app)
        .post('/subscription/convert-trial')
        .set('x-clerk-user-id', 'user_123')
        .send({ paymentMethodId: 'pm_123', billingCycle: 'annual' });

      expect(response.status).toBe(402);
      expect(response.body).toEqual({ error: 'card declined' });
    });

    it('returns fallback error message for non-Error conversion failures', async () => {
      mockConvertTrialToPaid.mockRejectedValue({ reason: 'unknown failure' });

      const response = await request(app)
        .post('/subscription/convert-trial')
        .set('x-clerk-user-id', 'user_123')
        .send({ paymentMethodId: 'pm_123', billingCycle: 'annual' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to convert trial' });
    });
  });

  describe('POST /subscription/create-checkout-session', () => {
    it('returns 400 when required checkout fields are missing', async () => {
      const response = await request(app)
        .post('/subscription/create-checkout-session')
        .set('x-clerk-user-id', 'user_123')
        .send({ priceId: 'price_123' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'priceId, successUrl, and cancelUrl are required',
      });
    });

    it('returns 400 when request payload fails URL/price validation', async () => {
      mockValidateStripePriceId.mockImplementation(() => {
        throw new Error('priceId has invalid length');
      });

      const response = await request(app)
        .post('/subscription/create-checkout-session')
        .set('x-clerk-user-id', 'user_123')
        .send({
          priceId: 'price_123',
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'priceId has invalid length' });
      expect(mockValidateRedirectUrl).not.toHaveBeenCalled();
    });

    it('rejects valid-looking Stripe price IDs that are not backend configured', async () => {
      const response = await request(app)
        .post('/subscription/create-checkout-session')
        .set('x-clerk-user-id', 'user_123')
        .send({
          priceId: 'price_attacker_controlled_1234567890',
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'priceId is not configured for checkout' });
      expect(mockStripeCheckoutSessionCreate).not.toHaveBeenCalled();
    });

    it('returns 500 when Stripe checkout price configuration is missing in production', async () => {
      envConfig.NODE_ENV = 'production';
      delete process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID;
      delete process.env.STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID;
      delete process.env.STRIPE_STARTER_MONTHLY_PRICE_ID;
      delete process.env.STRIPE_STARTER_ANNUAL_PRICE_ID;

      const response = await request(app)
        .post('/subscription/create-checkout-session')
        .set('x-clerk-user-id', 'user_123')
        .send({
          priceId: configuredStarterMonthlyPriceId,
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'Stripe price IDs are not configured on the server',
      });
      expect(mockStripeCheckoutSessionCreate).not.toHaveBeenCalled();
    });

    it('returns 404 when checkout is requested without an organization', async () => {
      mockFindUnique.mockResolvedValue({ organization: null });

      const response = await request(app)
        .post('/subscription/create-checkout-session')
        .set('x-clerk-user-id', 'user_123')
        .send({
          priceId: configuredStarterMonthlyPriceId,
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Organization not found' });
    });

    it('creates checkout session using existing Stripe customer id', async () => {
      const response = await request(app)
        .post('/subscription/create-checkout-session')
        .set('x-clerk-user-id', 'user_123')
        .send({
          priceId: configuredStarterMonthlyPriceId,
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        sessionId: 'cs_test_123',
        url: 'https://checkout.stripe.com/c/session_test_123',
      });
      expect(mockStripeCustomersCreate).not.toHaveBeenCalled();
      expect(mockStripeCheckoutSessionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_existing',
          line_items: [{ price: configuredStarterMonthlyPriceId, quantity: 1 }],
        }),
      );
    });

    it('creates checkout session for configured annual Stripe price id', async () => {
      const response = await request(app)
        .post('/subscription/create-checkout-session')
        .set('x-clerk-user-id', 'user_123')
        .send({
          priceId: configuredProfessionalAnnualPriceId,
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        });

      expect(response.status).toBe(200);
      expect(mockStripeCheckoutSessionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [{ price: configuredProfessionalAnnualPriceId, quantity: 1 }],
        }),
      );
    });

    it('creates and persists Stripe customer id when missing on existing subscription', async () => {
      mockFindUnique.mockResolvedValue({
        organization: {
          id: 'org-1',
          contactEmail: 'owner@example.com',
          subscriptionTiers: [
            {
              id: 'sub-1',
              stripeCustomerId: null,
            },
          ],
        },
      });

      const response = await request(app)
        .post('/subscription/create-checkout-session')
        .set('x-clerk-user-id', 'user_123')
        .send({
          priceId: configuredProfessionalMonthlyPriceId,
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        });

      expect(response.status).toBe(200);
      expect(mockStripeCustomersCreate).toHaveBeenCalledTimes(1);
      expect(mockSubscriptionTierUpdate).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { stripeCustomerId: 'cus_new' },
      });
      expect(mockStripeCheckoutSessionCreate).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_new' }),
      );
    });

    it('creates checkout session even when org has no subscription record yet', async () => {
      mockFindUnique.mockResolvedValue({
        organization: {
          id: 'org-1',
          contactEmail: 'owner@example.com',
          subscriptionTiers: [],
        },
      });

      const response = await request(app)
        .post('/subscription/create-checkout-session')
        .set('x-clerk-user-id', 'user_123')
        .send({
          priceId: configuredProfessionalMonthlyPriceId,
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        });

      expect(response.status).toBe(200);
      expect(mockStripeCustomersCreate).toHaveBeenCalledTimes(1);
      expect(mockSubscriptionTierUpdate).not.toHaveBeenCalled();
      expect(mockStripeCheckoutSessionCreate).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_new' }),
      );
    });

    it('passes undefined email to Stripe customer creation when contactEmail is null', async () => {
      mockFindUnique.mockResolvedValue({
        organization: {
          id: 'org-1',
          contactEmail: null,
          subscriptionTiers: [
            {
              id: 'sub-1',
              stripeCustomerId: null,
            },
          ],
        },
      });

      const response = await request(app)
        .post('/subscription/create-checkout-session')
        .set('x-clerk-user-id', 'user_123')
        .send({
          priceId: configuredProfessionalMonthlyPriceId,
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        });

      expect(response.status).toBe(200);
      expect(mockStripeCustomersCreate).toHaveBeenCalledWith({
        email: undefined,
        metadata: { organizationId: 'org-1' },
      });
    });

    it('returns fallback checkout error message for non-Error throws', async () => {
      mockStripeCheckoutSessionCreate.mockRejectedValue({ reason: 'checkout failed' });

      const response = await request(app)
        .post('/subscription/create-checkout-session')
        .set('x-clerk-user-id', 'user_123')
        .send({
          priceId: configuredProfessionalMonthlyPriceId,
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to create checkout session' });
    });
  });

  describe('POST /subscription/create-portal-session', () => {
    it('returns 400 when returnUrl is invalid', async () => {
      mockValidateRedirectUrl.mockImplementation(() => {
        throw new Error('returnUrl is not a valid URL: not-a-url');
      });

      const response = await request(app)
        .post('/subscription/create-portal-session')
        .set('x-clerk-user-id', 'user_123')
        .send({ returnUrl: 'not-a-url' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'returnUrl is not a valid URL: not-a-url' });
    });

    it('returns 404 when portal session is requested without organization', async () => {
      mockFindUnique.mockResolvedValue({ organization: null });

      const response = await request(app)
        .post('/subscription/create-portal-session')
        .set('x-clerk-user-id', 'user_123')
        .send({ returnUrl: 'http://localhost:3000/settings' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Organization not found' });
    });

    it('returns 400 when no Stripe customer exists for portal session', async () => {
      mockFindUnique.mockResolvedValue({
        organization: {
          subscriptionTiers: [{ stripeCustomerId: null }],
        },
      });

      const response = await request(app)
        .post('/subscription/create-portal-session')
        .set('x-clerk-user-id', 'user_123');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'No Stripe customer found' });
    });

    it('creates portal session using provided returnUrl', async () => {
      const response = await request(app)
        .post('/subscription/create-portal-session')
        .set('x-clerk-user-id', 'user_123')
        .send({ returnUrl: 'http://localhost:3000/account' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ url: 'https://billing.stripe.com/session_test_123' });
      expect(mockStripeBillingPortalSessionCreate).toHaveBeenCalledWith({
        customer: 'cus_existing',
        return_url: 'http://localhost:3000/account',
      });
    });

    it('defaults portal return_url when request omits returnUrl', async () => {
      const response = await request(app)
        .post('/subscription/create-portal-session')
        .set('x-clerk-user-id', 'user_123')
        .send({});

      expect(response.status).toBe(200);
      expect(mockStripeBillingPortalSessionCreate).toHaveBeenCalledWith({
        customer: 'cus_existing',
        return_url: 'http://localhost:3000/settings',
      });
    });

    it('returns portal error message when Stripe portal creation throws Error', async () => {
      mockStripeBillingPortalSessionCreate.mockRejectedValue(new Error('portal unavailable'));

      const response = await request(app)
        .post('/subscription/create-portal-session')
        .set('x-clerk-user-id', 'user_123')
        .send({ returnUrl: 'http://localhost:3000/account' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'portal unavailable' });
    });
  });
});
