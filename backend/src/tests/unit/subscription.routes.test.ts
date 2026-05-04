import express from 'express';
import request from 'supertest';
import { BillingCycle } from '../../types/subscription';

const mockFindUnique = jest.fn();
const mockSubscriptionTierUpdate = jest.fn();
const mockConvertTrialToPaid = jest.fn();

const mockStripeCustomersCreate = jest.fn();
const mockStripeCheckoutSessionCreate = jest.fn();
const mockStripeBillingPortalSessionCreate = jest.fn();

const mockValidateRedirectUrl = jest.fn();
const mockValidateStripePriceId = jest.fn();

jest.mock('../../middleware/clerk-auth.middleware', () => ({
  clerkAuth: (req: any, _res: any, next: any) => {
    req.userId = req.get('x-clerk-user-id') || 'user_123';
    next();
  },
}));

jest.mock('../../middleware/rateLimiter', () => ({
  trialConversionLimiter: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../database/database-factory', () => ({
  getDefaultDatabaseClient: () => ({
    user: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
    subscriptionTier: {
      update: (...args: unknown[]) => mockSubscriptionTierUpdate(...args),
    },
  }),
}));

jest.mock('../../services/subscription.service', () => ({
  SubscriptionService: jest.fn().mockImplementation(() => ({
    convertTrialToPaid: (...args: unknown[]) => mockConvertTrialToPaid(...args),
  })),
}));

jest.mock('../../utils/stripe', () => ({
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

jest.mock('../../utils/url-validator', () => ({
  validateRedirectUrl: (...args: unknown[]) => mockValidateRedirectUrl(...args),
  validateStripePriceId: (...args: unknown[]) => mockValidateStripePriceId(...args),
}));

import subscriptionRouter from '../../routes/subscription.routes';

const actualDi = jest.requireActual('../../di/container') as typeof import('../../di/container');
const actualUserRepository = jest.requireActual(
  '../../repositories/user.repository',
) as typeof import('../../repositories/user.repository');
const actualSubscriptionRepository = jest.requireActual(
  '../../repositories/subscription.repository',
) as typeof import('../../repositories/subscription.repository');
const actualSubscriptionService = jest.requireActual(
  '../../services/subscription.service',
) as typeof import('../../services/subscription.service');

describe('subscription.routes', () => {
  const app = express();

  app.use(express.json());
  app.use('/subscription', subscriptionRouter);
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
    jest.clearAllMocks();

    process.env.FRONTEND_URL = 'http://localhost:3000';

    mockValidateStripePriceId.mockImplementation(() => undefined);
    mockValidateRedirectUrl.mockImplementation(() => undefined);

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

    mockStripeCustomersCreate.mockResolvedValue({ id: 'cus_new' });
    mockSubscriptionTierUpdate.mockResolvedValue({ id: 'sub-1', stripeCustomerId: 'cus_new' });
    mockStripeCheckoutSessionCreate.mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/session_test_123',
    });
    mockStripeBillingPortalSessionCreate.mockResolvedValue({
      url: 'https://billing.stripe.com/session_test_123',
    });

    const diContainer = actualDi.getDiContainer();
    diContainer.registerInstance(actualUserRepository.UserRepository, {
      findByClerkUserIdWithOrganizationSubscriptions: (...args: unknown[]) =>
        mockFindUnique(...args),
      findOrganizationIdByClerkUserId: (...args: unknown[]) => mockFindUnique(...args),
    } as never);
    diContainer.registerInstance(actualSubscriptionRepository.SubscriptionRepository, {
      updateStripeCustomerId: (id: number, stripeCustomerId: string) =>
        mockSubscriptionTierUpdate({
          where: { id },
          data: { stripeCustomerId },
        }),
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

    it('returns active trial status with remaining days', async () => {
      mockFindUnique.mockResolvedValue({
        organization: {
          subscriptionTiers: [
            {
              status: 'TRIALING',
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
      expect(response.body.subscription.daysRemaining).toBeGreaterThanOrEqual(1);
    });

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
        status: 'ACTIVE',
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

    it('returns 404 when checkout is requested without an organization', async () => {
      mockFindUnique.mockResolvedValue({ organization: null });

      const response = await request(app)
        .post('/subscription/create-checkout-session')
        .set('x-clerk-user-id', 'user_123')
        .send({
          priceId: 'price_1234567890',
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
          priceId: 'price_1234567890',
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
        expect.objectContaining({ customer: 'cus_existing' }),
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
          priceId: 'price_1234567890',
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
          priceId: 'price_1234567890',
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
          priceId: 'price_1234567890',
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
          priceId: 'price_1234567890',
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
        throw new Error('returnUrl is not a valid URL');
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
