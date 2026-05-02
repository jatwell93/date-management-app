import { Request, Response, RequestHandler } from 'express';
import { ClerkAuthRequest } from '../middleware/clerk-auth.middleware';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { SubscriptionService } from '../services/subscription.service';
import { BillingCycle } from '../types/subscription';
import { getStripeClient } from '../utils/stripe';
import { validateRedirectUrl, validateStripePriceId } from '../utils/url-validator';
import { injectable, inject } from 'tsyringe';
import { NotFoundError, ValidationError, AuthenticationError, InternalError } from '../errors';

const prisma = getDefaultDatabaseClient();

interface SubscriptionTierResponse {
  status: 'ACTIVE' | 'TRIALING' | 'EXPIRED' | 'CANCELED';
  tierLevel: string;
  trialEndDate: string | null;
  trialStartedAt: string | null;
  trialConvertedAt: string | null;
  daysRemaining: number | null;
  billingCycle: string | null;
}

interface TrialStatusResponse {
  isInTrial: boolean;
  isTrialExpired: boolean;
  subscription: SubscriptionTierResponse | null;
  tierLimits: {
    maxUsers: number;
    maxProducts: number;
    maxStoreAreas: number;
    features: string[];
  };
}

const TIER_LIMITS = {
  starter: {
    maxUsers: 1,
    maxProducts: 500,
    maxStoreAreas: 3,
    features: ['Basic scanning', 'Expiry tracking', 'Basic reports'],
  },
  professional: {
    maxUsers: 10,
    maxProducts: 5000,
    maxStoreAreas: 20,
    features: [
      'Advanced scanning',
      'Expiry tracking',
      'All reports',
      'CSV uploads',
      'Team management',
      'Organization invites',
    ],
  },
  premium: {
    maxUsers: 50,
    maxProducts: 25000,
    maxStoreAreas: 100,
    features: [
      'All professional features',
      'Priority support',
      'Custom integrations',
      'API access',
    ],
  },
  concierge: {
    maxUsers: -1,
    maxProducts: -1,
    maxStoreAreas: -1,
    features: ['Unlimited everything', 'Dedicated support', 'Custom development'],
  },
};

@injectable()
export class SubscriptionController {
  constructor(private subscriptionService: SubscriptionService) {}

  async getTrialStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as unknown as ClerkAuthRequest).userId;

      if (!userId) {
        throw new AuthenticationError('User ID missing from request');
      }

      const user = await prisma.user.findUnique({
        where: { clerkUserId: userId },
        include: {
          organization: {
            include: {
              subscriptionTiers: true,
            },
          },
        },
      });

      if (!user || !user.organization) {
        throw new NotFoundError('User or organization not found');
      }

      // Get the most recent subscription tier
      const subscription = user.organization.subscriptionTiers?.[0] ?? null;
      const now = new Date();

      let daysRemaining: number | null = null;
      let isTrialExpired = false;

      if (subscription?.status === 'TRIALING' && subscription.trialEndDate) {
        const trialEnd = new Date(subscription.trialEndDate);
        const diffTime = trialEnd.getTime() - now.getTime();
        daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        isTrialExpired = daysRemaining < 0;
      }

      const tierKey = subscription?.tierLevel?.toLowerCase() || 'starter';
      const limits = TIER_LIMITS[tierKey as keyof typeof TIER_LIMITS] || TIER_LIMITS.starter;

      const response: TrialStatusResponse = {
        isInTrial: subscription?.status === 'TRIALING' && !isTrialExpired,
        isTrialExpired: subscription?.status === 'TRIALING' && isTrialExpired,
        subscription: subscription
          ? {
              status: subscription.status as SubscriptionTierResponse['status'],
              tierLevel: subscription.tierLevel,
              trialEndDate: subscription.trialEndDate?.toISOString() || null,
              trialStartedAt: subscription.trialStartedAt?.toISOString() || null,
              trialConvertedAt: subscription.trialConvertedAt?.toISOString() || null,
              daysRemaining,
              billingCycle: subscription.billingCycle || null,
            }
          : null,
        tierLimits: limits,
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching trial status:', error);
      if (error instanceof NotFoundError || error instanceof AuthenticationError) {
        throw error;
      }
      throw new InternalError('Failed to fetch trial status');
    }
  }

  async convertTrial(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as unknown as ClerkAuthRequest).userId;
      const { paymentMethodId, billingCycle } = req.body;

      if (!paymentMethodId) {
        throw new ValidationError('paymentMethodId is required');
      }

      if (!billingCycle || !['monthly', 'annual'].includes(billingCycle)) {
        throw new ValidationError('billingCycle must be "monthly" or "annual"');
      }

      if (!userId) {
        throw new AuthenticationError('User ID missing from request');
      }

      // Get user's organization
      const user = await prisma.user.findUnique({
        where: { clerkUserId: userId },
        select: { organizationId: true },
      });

      if (!user?.organizationId) {
        throw new NotFoundError('User organization not found');
      }

      const converted = await this.subscriptionService.convertTrialToPaid(
        user.organizationId,
        paymentMethodId,
        billingCycle === 'annual' ? BillingCycle.ANNUAL : BillingCycle.MONTHLY,
      );

      res.json({
        success: true,
        subscription: {
          id: converted.id,
          tierLevel: converted.tierLevel,
          status: converted.status,
          billingCycle: converted.billingCycle,
          trialConvertedAt: converted.trialConvertedAt,
        },
      });
    } catch (error: unknown) {
      console.error('Error converting trial:', error);
      if (
        error instanceof ValidationError ||
        error instanceof NotFoundError ||
        error instanceof AuthenticationError
      ) {
        throw error;
      }
      throw new InternalError('Failed to convert trial');
    }
  }

  async createCheckoutSession(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as unknown as ClerkAuthRequest).userId;
      const { priceId, successUrl, cancelUrl } = req.body;

      // Validate required fields
      if (!priceId || !successUrl || !cancelUrl) {
        throw new ValidationError('priceId, successUrl, and cancelUrl are required');
      }

      if (!userId) {
        throw new AuthenticationError('User ID missing from request');
      }

      // Validate input formats
      try {
        validateStripePriceId(priceId);
        validateRedirectUrl(successUrl, 'successUrl');
        validateRedirectUrl(cancelUrl, 'cancelUrl');
      } catch (validationError: unknown) {
        throw new ValidationError(
          validationError instanceof Error ? validationError.message : 'Invalid request payload',
        );
      }

      const user = await prisma.user.findUnique({
        where: { clerkUserId: userId },
        include: { organization: { include: { subscriptionTiers: true } } },
      });

      if (!user?.organization) {
        throw new NotFoundError('Organization not found');
      }

      const subscription = user.organization.subscriptionTiers?.[0];
      const stripe = getStripeClient();

      // Get or create Stripe customer
      let customerId = subscription?.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.organization.contactEmail ?? undefined,
          metadata: { organizationId: user.organization.id },
        });
        customerId = customer.id;

        // Persist the customer ID to database
        if (subscription) {
          await prisma.subscriptionTier.update({
            where: { id: subscription.id },
            data: { stripeCustomerId: customerId },
          });
        }
      }

      // Create Checkout Session
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { organizationId: user.organization.id },
      });

      res.json({ sessionId: session.id, url: session.url });
    } catch (error: unknown) {
      console.error('Error creating checkout session:', error);
      if (
        error instanceof ValidationError ||
        error instanceof NotFoundError ||
        error instanceof AuthenticationError
      ) {
        throw error;
      }
      throw new InternalError('Failed to create checkout session');
    }
  }

  async createPortalSession(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as unknown as ClerkAuthRequest).userId;
      const { returnUrl } = req.body;

      if (!userId) {
        throw new AuthenticationError('User ID missing from request');
      }

      // Validate returnUrl if provided
      if (returnUrl) {
        try {
          validateRedirectUrl(returnUrl, 'returnUrl');
        } catch (validationError: unknown) {
          throw new ValidationError(
            validationError instanceof Error ? validationError.message : 'Invalid returnUrl',
          );
        }
      }

      const user = await prisma.user.findUnique({
        where: { clerkUserId: userId },
        include: { organization: { include: { subscriptionTiers: true } } },
      });

      if (!user?.organization) {
        throw new NotFoundError('Organization not found');
      }

      const subscription = user.organization.subscriptionTiers?.[0];
      if (!subscription?.stripeCustomerId) {
        throw new ValidationError('No Stripe customer found');
      }

      const stripe = getStripeClient();
      const session = await stripe.billingPortal.sessions.create({
        customer: subscription.stripeCustomerId,
        return_url: returnUrl || `${process.env.FRONTEND_URL}/settings`,
      });

      res.json({ url: session.url });
    } catch (error: unknown) {
      console.error('Error creating portal session:', error);
      if (
        error instanceof ValidationError ||
        error instanceof NotFoundError ||
        error instanceof AuthenticationError
      ) {
        throw error;
      }
      throw new InternalError('Failed to create portal session');
    }
  }
}
