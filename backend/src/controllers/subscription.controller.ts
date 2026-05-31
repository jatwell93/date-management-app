import { Request, Response } from 'express';
import { ClerkAuthRequest } from '../middleware/clerk-auth.middleware';
import { SubscriptionService } from '../services/subscription.service';
import { BillingCycle, SubscriptionStatus } from '../types/subscription';
import { getStripeClient } from '../utils/stripe';
import {
  StripePriceConfigurationError,
  validateRedirectUrl,
  validateStripePriceId,
} from '../utils/url-validator';
import { injectable, inject } from 'tsyringe';
import { Logger } from '../utils/logger';
import { NotFoundError, ValidationError, AuthenticationError, InternalError } from '../errors';
import { UserRepository } from '../repositories/user.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';

interface SubscriptionTierResponse {
  status: `${SubscriptionStatus}`;
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
  constructor(
    private subscriptionService: SubscriptionService,
    private userRepository: UserRepository,
    private subscriptionRepository: SubscriptionRepository,
    @inject('StripeClientFactory')
    private stripeClientFactory: () => ReturnType<typeof getStripeClient>,
  ) {}

  async getTrialStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as unknown as ClerkAuthRequest).userId;

      if (!userId) {
        throw new AuthenticationError('User ID missing from request');
      }

      const user = await this.userRepository.findByClerkUserIdWithOrganizationSubscriptions(userId);

      if (!user || !user.organization) {
        throw new NotFoundError('User or organization not found');
      }

      // Get the most recent subscription tier
      const subscription = user.organization.subscriptionTiers?.[0] ?? null;
      const now = new Date();
      const subscriptionStatus = subscription?.status?.toLowerCase();

      let daysRemaining: number | null = null;
      let isTrialExpired = false;

      if (subscriptionStatus === SubscriptionStatus.TRIALING && subscription.trialEndDate) {
        const trialEnd = new Date(subscription.trialEndDate);
        const diffTime = trialEnd.getTime() - now.getTime();
        daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        isTrialExpired = daysRemaining < 0;
      }

      const tierKey = subscription?.tierLevel?.toLowerCase() || 'starter';
      const limits = TIER_LIMITS[tierKey as keyof typeof TIER_LIMITS] || TIER_LIMITS.starter;

      const response: TrialStatusResponse = {
        isInTrial: subscriptionStatus === SubscriptionStatus.TRIALING && !isTrialExpired,
        isTrialExpired:
          (subscriptionStatus === SubscriptionStatus.TRIALING && isTrialExpired) ||
          subscriptionStatus === SubscriptionStatus.EXPIRED,
        subscription: subscription
          ? {
              status: subscriptionStatus as SubscriptionTierResponse['status'],
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
      Logger.error('Error fetching trial status', {
        error: error instanceof Error ? error.message : String(error),
      });
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
      const user = await this.userRepository.findOrganizationIdByClerkUserId(userId);

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
      Logger.error('Error converting trial', {
        error: error instanceof Error ? error.message : String(error),
      });
      if (
        error instanceof ValidationError ||
        error instanceof NotFoundError ||
        error instanceof AuthenticationError
      ) {
        throw error;
      }
      if (
        error instanceof Error &&
        typeof (error as Error & { statusCode?: unknown }).statusCode === 'number'
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
        if (validationError instanceof StripePriceConfigurationError) {
          throw new InternalError(validationError.message, true);
        }

        throw new ValidationError(
          validationError instanceof Error ? validationError.message : 'Invalid request payload',
        );
      }

      const user = await this.userRepository.findByClerkUserIdWithOrganizationSubscriptions(userId);

      if (!user?.organization) {
        throw new NotFoundError('Organization not found');
      }

      const subscription = user.organization.subscriptionTiers?.[0];
      const stripe = this.stripeClientFactory();

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
          await this.subscriptionRepository.updateStripeCustomerId(subscription.id, customerId);
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
      Logger.error('Error creating checkout session', {
        error: error instanceof Error ? error.message : String(error),
      });
      if (
        error instanceof ValidationError ||
        error instanceof NotFoundError ||
        error instanceof AuthenticationError ||
        error instanceof InternalError
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

      const user = await this.userRepository.findByClerkUserIdWithOrganizationSubscriptions(userId);

      if (!user?.organization) {
        throw new NotFoundError('Organization not found');
      }

      const subscription = user.organization.subscriptionTiers?.[0];
      if (!subscription?.stripeCustomerId) {
        throw new ValidationError('No Stripe customer found');
      }

      const stripe = this.stripeClientFactory();
      const session = await stripe.billingPortal.sessions.create({
        customer: subscription.stripeCustomerId,
        return_url: returnUrl || `${process.env.FRONTEND_URL}/settings`,
      });

      res.json({ url: session.url });
    } catch (error: unknown) {
      Logger.error('Error creating portal session', {
        error: error instanceof Error ? error.message : String(error),
      });
      if (
        error instanceof ValidationError ||
        error instanceof NotFoundError ||
        error instanceof AuthenticationError
      ) {
        throw error;
      }
      if (error instanceof Error) {
        throw new InternalError(error.message);
      }
      throw new InternalError('Failed to create portal session');
    }
  }
}
