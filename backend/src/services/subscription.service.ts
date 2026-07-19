/**
 * Stripe Subscription Service facade.
 *
 * Existing callers keep using this class while focused lifecycle collaborators
 * own access checks, trial workflows, and billing-state mutations.
 */

import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { envConfig } from '../config/environment';
import { Logger } from '../utils/logger';
import { SubscriptionTier } from '../models/subscription-tier.model';
import { BillingCycle, TierLevel, TIER_LIMITS } from '../types/subscription';
import { injectable, inject } from 'tsyringe';
import { SubscriptionAccessService } from './subscription-access.service';
import { SubscriptionBillingLifecycleService } from './subscription-billing-lifecycle.service';
import { SubscriptionTrialLifecycleService } from './subscription-trial-lifecycle.service';

// Stripe SDK v22 throws at construction when the apiKey is empty; v13 deferred
// that error to the first request. In dev/test the key is often unset, and this
// facade must still construct (it is wired up eagerly by WebhookService). Use an
// obviously-invalid placeholder so construction succeeds and any real API call
// fails with a 401 at call time — preserving the pre-v22 "defer until used"
// behavior instead of crashing service wiring.
const STRIPE_UNCONFIGURED_KEY_PLACEHOLDER = 'sk_test_unconfigured_placeholder';

@injectable()
export class SubscriptionService {
  private readonly prisma: PrismaClient;
  private readonly stripe: Stripe;
  private readonly accessService: SubscriptionAccessService;
  private readonly billingLifecycleService: SubscriptionBillingLifecycleService;
  private readonly trialLifecycleService: SubscriptionTrialLifecycleService;

  constructor(
    @inject(PrismaClient) prismaClient?: PrismaClient,
    stripeClient?: Stripe,
    accessService?: SubscriptionAccessService,
    billingLifecycleService?: SubscriptionBillingLifecycleService,
    trialLifecycleService?: SubscriptionTrialLifecycleService,
  ) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.stripe = stripeClient ?? this.createStripeClient();
    this.accessService = accessService ?? new SubscriptionAccessService(this.stripe);
    this.billingLifecycleService =
      billingLifecycleService ?? new SubscriptionBillingLifecycleService(this.prisma, this.stripe);
    this.trialLifecycleService =
      trialLifecycleService ?? new SubscriptionTrialLifecycleService(this.prisma, this.stripe);
  }

  getTierLimits(tierLevel: TierLevel): Record<string, number | null> {
    return TIER_LIMITS[tierLevel] || {};
  }

  async isAccessActive(subscriptionTier: SubscriptionTier): Promise<boolean> {
    return this.accessService.isAccessActive(subscriptionTier);
  }

  async createTrialSubscription(organizationId: string, trialDays: number = 14): Promise<void> {
    return this.trialLifecycleService.createTrialSubscription(organizationId, trialDays);
  }

  async createSubscription(
    organizationId: string,
    priceId: string,
    billingCycle: BillingCycle,
  ): Promise<SubscriptionTier> {
    return this.billingLifecycleService.createSubscription(organizationId, priceId, billingCycle);
  }

  async updateSubscription(organizationId: string, newPriceId: string): Promise<SubscriptionTier> {
    return this.billingLifecycleService.updateSubscription(organizationId, newPriceId);
  }

  async cancelSubscription(organizationId: string): Promise<SubscriptionTier> {
    return this.billingLifecycleService.cancelSubscription(organizationId);
  }

  async reactivateSubscription(organizationId: string): Promise<SubscriptionTier> {
    return this.billingLifecycleService.reactivateSubscription(organizationId);
  }

  async syncSubscriptionState(
    organizationId: string,
    stripeSubscription: Stripe.Subscription,
  ): Promise<SubscriptionTier> {
    return this.billingLifecycleService.syncSubscriptionState(organizationId, stripeSubscription);
  }

  async findTrialsNeedingReminders(): Promise<
    Array<{
      organizationId: string;
      organizationName: string;
      contactEmail: string | null;
      daysRemaining: number;
      trialEndDate: Date;
    }>
  > {
    return this.trialLifecycleService.findTrialsNeedingReminders();
  }

  async logTrialEvent(
    organizationId: string,
    eventType: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    return this.trialLifecycleService.logTrialEvent(organizationId, eventType, metadata);
  }

  async downgradeExpiredTrials(): Promise<number> {
    return this.trialLifecycleService.downgradeExpiredTrials();
  }

  async downgradeExpiredPastDue(): Promise<number> {
    return this.billingLifecycleService.downgradeExpiredPastDue();
  }

  async convertTrialToPaid(
    organizationId: string,
    stripePaymentMethodId: string,
    billingCycle: BillingCycle,
  ): Promise<SubscriptionTier> {
    return this.trialLifecycleService.convertTrialToPaid(
      organizationId,
      stripePaymentMethodId,
      billingCycle,
    );
  }

  async getRecentlyDowngradedTrials(): Promise<
    Array<{
      organizationId: string;
      organizationName: string;
      contactEmail: string | null;
    }>
  > {
    return this.trialLifecycleService.getRecentlyDowngradedTrials();
  }

  private createStripeClient(): Stripe {
    const stripeSecretKey = envConfig.STRIPE_SECRET_KEY;

    if (!stripeSecretKey) {
      const nodeEnv = process.env.NODE_ENV || 'development';
      const isTest =
        process.env.TEST_AUTH_BYPASS === 'true' || process.env.JEST_WORKER_ID !== undefined;
      if (nodeEnv === 'production' && !isTest) {
        throw new Error(
          'STRIPE_SECRET_KEY is required in production. ' +
            'Set a valid Stripe secret key before starting the application.',
        );
      }
      if (!isTest) {
        Logger.warn(
          'STRIPE_SECRET_KEY not configured; Stripe operations will fail. Set the key to enable billing.',
        );
      }
    }

    return new Stripe(stripeSecretKey || STRIPE_UNCONFIGURED_KEY_PLACEHOLDER, {
      apiVersion: '2026-06-24.dahlia',
    });
  }
}

export default SubscriptionService;
