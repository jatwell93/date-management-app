import { PrismaClient } from '@prisma/client';
import * as Sentry from '@sentry/node';
import Stripe from 'stripe';
import { InternalError, NotFoundError, ValidationError } from '../errors';
import { SubscriptionTier } from '../models/subscription-tier.model';
import { BillingCycle, SubscriptionStatus, TierLevel } from '../types/subscription';
import { Logger } from '../utils/logger';
import { getPriceIdForTier, normalizeLegacyTier } from './subscription-billing.helpers';
import { buildTrialSubscriptionSetup } from './subscription-trial.helpers';
import { getErrorMessage, mapPrismaSubscriptionTierToModel } from './subscription-mapping.helpers';
import { OrganizationRepository } from '../repositories/organization.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { TrialEventRepository } from '../repositories/trial-event.repository';

export class SubscriptionTrialLifecycleService {
  private prisma: PrismaClient;
  private orgRepo: OrganizationRepository;
  private subscriptionRepo: SubscriptionRepository;
  private trialEventRepo: TrialEventRepository;

  constructor(
    prismaClient: PrismaClient,
    private readonly stripe: Stripe,
    orgRepo?: OrganizationRepository,
    subscriptionRepo?: SubscriptionRepository,
    trialEventRepo?: TrialEventRepository,
  ) {
    this.prisma = prismaClient;
    this.orgRepo = orgRepo ?? new OrganizationRepository(prismaClient);
    this.subscriptionRepo = subscriptionRepo ?? new SubscriptionRepository(prismaClient);
    this.trialEventRepo = trialEventRepo ?? new TrialEventRepository(prismaClient);
  }

  async createTrialSubscription(organizationId: string, trialDays: number = 14): Promise<void> {
    const organization = await this.orgRepo.findById(organizationId);

    if (!organization) {
      throw new NotFoundError(`Organization ${organizationId} not found`);
    }

    const stripeCustomer = await this.stripe.customers.create({
      email: organization.contactEmail ?? undefined,
      description: `Org: ${organization.name}`,
      metadata: { organizationId },
    });

    const trialSetup = buildTrialSubscriptionSetup(
      organizationId,
      stripeCustomer.id,
      trialDays,
      new Date(),
    );

    await this.subscriptionRepo.create(trialSetup.subscriptionTierData);

    await this.subscriptionRepo.createUsage(trialSetup.organizationUsageData);

    await this.logTrialEvent(organizationId, 'trial_started', {
      trialDays,
      tierLevel: 'professional',
      trialEndDate: trialSetup.trialEndDate.toISOString(),
    });

    Logger.info(
      `Trial subscription created for organization ${organizationId}, ends ${trialSetup.trialEndDate.toISOString()}`,
    );
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
    const now = new Date();
    const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const expiringTrials = await this.subscriptionRepo.findTrialingExpiringBefore(
      fourteenDaysFromNow,
      now,
    );

    const results: Array<{
      organizationId: string;
      organizationName: string;
      contactEmail: string | null;
      daysRemaining: number;
      trialEndDate: Date;
    }> = [];

    for (const trial of expiringTrials) {
      if (!trial.trialEndDate) {
        Logger.warn('Skipping trial reminder check: trialEndDate is null', {
          organizationId: trial.organizationId,
        });
        continue;
      }

      const daysRemaining = Math.ceil(
        (trial.trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (![10, 5, 2].includes(daysRemaining)) continue;

      const existingEvent = await this.trialEventRepo.findRecentByOrganizationAndType(
        trial.organizationId,
        'trial_reminder_sent',
        new Date(now.getTime() - 24 * 60 * 60 * 1000),
      );

      if (existingEvent) continue;

      results.push({
        organizationId: trial.organizationId,
        organizationName: trial.organization.name,
        contactEmail: trial.organization.contactEmail,
        daysRemaining,
        trialEndDate: trial.trialEndDate,
      });
    }

    return results;
  }

  async logTrialEvent(
    organizationId: string,
    eventType: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.trialEventRepo.create({
      organizationId,
      eventType,
      metadata: JSON.stringify(metadata),
      occurredAt: new Date(),
    });
  }

  async downgradeExpiredTrials(): Promise<number> {
    const now = new Date();

    const expiredTrials = await this.subscriptionRepo.findExpiredTrials(now);

    if (expiredTrials.length === 0) {
      return 0;
    }

    let downgradedCount = 0;

    for (const trial of expiredTrials) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await this.subscriptionRepo.update(
            trial.id,
            {
              status: SubscriptionStatus.ACTIVE,
              tierLevel: 'free',
              stripeSubscriptionId: null,
            },
            tx,
          );

          await this.trialEventRepo.create(
            {
              organizationId: trial.organizationId,
              eventType: 'trial_expired',
              metadata: JSON.stringify({ downgradedTo: 'free' }),
              occurredAt: new Date(),
            },
            tx,
          );
        });

        downgradedCount++;
        Logger.info(`Downgraded expired trial for organization ${trial.organizationId}`);
      } catch (error) {
        Logger.error(`Failed to downgrade trial for org ${trial.organizationId}: ${String(error)}`);
      }
    }

    return downgradedCount;
  }

  async convertTrialToPaid(
    organizationId: string,
    stripePaymentMethodId: string,
    billingCycle: BillingCycle,
  ): Promise<SubscriptionTier> {
    const trial = await this.subscriptionRepo.findTrialingByOrganizationId(organizationId);

    if (!trial) {
      throw new NotFoundError(`No active trial found for organization ${organizationId}`);
    }

    if (!trial.stripeCustomerId) {
      throw new InternalError('No Stripe customer found for this trial');
    }

    // Legacy premium/concierge trials normalize to their launch-tier
    // replacements; tiers without a Checkout price (free, enterprise) are
    // rejected as a client error rather than surfacing as a 500.
    const checkoutTier = normalizeLegacyTier(trial.tierLevel as TierLevel);
    let priceId: string;
    try {
      priceId = getPriceIdForTier(checkoutTier, billingCycle);
    } catch (error) {
      throw new ValidationError(getErrorMessage(error));
    }

    try {
      const stripeSubscription = await this.stripe.subscriptions.create({
        customer: trial.stripeCustomerId,
        items: [{ price: priceId }],
        default_payment_method: stripePaymentMethodId,
        payment_behavior: 'error_if_incomplete',
      });

      const updated = await this.prisma.$transaction(async (tx) => {
        const updatedTier = await this.subscriptionRepo.update(
          trial.id,
          {
            status: SubscriptionStatus.ACTIVE,
            stripeSubscriptionId: stripeSubscription.id,
            trialConvertedAt: new Date(),
            billingCycle,
          },
          tx,
        );

        await this.trialEventRepo.create(
          {
            organizationId,
            eventType: 'trial_converted',
            metadata: JSON.stringify({
              stripeSubscriptionId: stripeSubscription.id,
              billingCycle,
            }),
            occurredAt: new Date(),
          },
          tx,
        );

        return updatedTier;
      });

      Logger.info(`Converted trial to paid for organization ${organizationId}`);
      return mapPrismaSubscriptionTierToModel(updated);
    } catch (error: unknown) {
      Logger.error(`Failed to convert trial for org ${organizationId}:`, {
        error: getErrorMessage(error),
      });

      if (error instanceof Stripe.errors.StripeError) {
        Sentry.captureException(error, {
          level: 'error',
          tags: { service: 'subscription-service', event: 'convert-trial' },
          extra: {
            organizationId,
            stripeRequestId: error.requestId,
            stripeCode: error.code,
          },
        });
      } else {
        Sentry.captureException(error, {
          level: 'error',
          tags: { service: 'subscription-service', event: 'convert-trial' },
          extra: { organizationId },
        });
      }

      throw new InternalError(`Payment failed: ${getErrorMessage(error)}`);
    }
  }

  async getRecentlyDowngradedTrials(): Promise<
    Array<{
      organizationId: string;
      organizationName: string;
      contactEmail: string | null;
    }>
  > {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const events = await this.trialEventRepo.findRecentByType('trial_expired', yesterday);

    const results: Array<{
      organizationId: string;
      organizationName: string;
      contactEmail: string | null;
    }> = [];

    for (const event of events) {
      const org = await this.orgRepo.findByIdSelect(event.organizationId);

      if (org) {
        results.push({
          organizationId: event.organizationId,
          organizationName: org.name,
          contactEmail: org.contactEmail,
        });
      }
    }

    return results;
  }
}
