import { PrismaClient } from '@prisma/client';
import * as Sentry from '@sentry/node';
import Stripe from 'stripe';
import { InternalError, NotFoundError } from '../errors';
import { SubscriptionTier } from '../models/subscription-tier.model';
import { BillingCycle, SubscriptionStatus, TierLevel } from '../types/subscription';
import { Logger } from '../utils/logger';
import { getPriceIdForTier } from './subscription-billing.helpers';
import { buildTrialSubscriptionSetup } from './subscription-trial.helpers';
import { getErrorMessage, mapPrismaSubscriptionTierToModel } from './subscription-mapping.helpers';

export class SubscriptionTrialLifecycleService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly stripe: Stripe,
  ) {}

  async createTrialSubscription(organizationId: string, trialDays: number = 14): Promise<void> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

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

    await this.prisma.subscriptionTier.create({
      data: trialSetup.subscriptionTierData,
    });

    await this.prisma.organizationUsage.create({
      data: trialSetup.organizationUsageData,
    });

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

    const expiringTrials = await this.prisma.subscriptionTier.findMany({
      where: {
        status: SubscriptionStatus.TRIALING,
        trialEndDate: {
          gte: now,
          lte: fourteenDaysFromNow,
        },
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            contactEmail: true,
          },
        },
      },
    });

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

      const existingEvent = await this.prisma.trialEvent.findFirst({
        where: {
          organizationId: trial.organizationId,
          eventType: 'trial_reminder_sent',
          occurredAt: {
            gte: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          },
        },
      });

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
    await this.prisma.trialEvent.create({
      data: {
        organizationId,
        eventType,
        metadata: JSON.stringify(metadata),
        occurredAt: new Date(),
      },
    });
  }

  async downgradeExpiredTrials(): Promise<number> {
    const now = new Date();

    const expiredTrials = await this.prisma.subscriptionTier.findMany({
      where: {
        status: SubscriptionStatus.TRIALING,
        trialEndDate: {
          lt: now,
        },
      },
      select: {
        id: true,
        organizationId: true,
      },
    });

    if (expiredTrials.length === 0) {
      return 0;
    }

    let downgradedCount = 0;

    for (const trial of expiredTrials) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.subscriptionTier.update({
            where: { id: trial.id },
            data: {
              status: SubscriptionStatus.ACTIVE,
              tierLevel: 'starter',
              stripeSubscriptionId: null,
            },
          });

          await tx.trialEvent.create({
            data: {
              organizationId: trial.organizationId,
              eventType: 'trial_expired',
              metadata: JSON.stringify({ downgradedTo: 'starter' }),
              occurredAt: new Date(),
            },
          });
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
    const trial = await this.prisma.subscriptionTier.findFirst({
      where: {
        organizationId,
        status: SubscriptionStatus.TRIALING,
      },
      include: {
        organization: true,
      },
    });

    if (!trial) {
      throw new NotFoundError(`No active trial found for organization ${organizationId}`);
    }

    if (!trial.stripeCustomerId) {
      throw new InternalError('No Stripe customer found for this trial');
    }

    const priceId = getPriceIdForTier(trial.tierLevel as TierLevel, billingCycle);

    try {
      const stripeSubscription = await this.stripe.subscriptions.create({
        customer: trial.stripeCustomerId,
        items: [{ price: priceId }],
        default_payment_method: stripePaymentMethodId,
        payment_behavior: 'error_if_incomplete',
      });

      const updated = await this.prisma.$transaction(async (tx) => {
        const updatedTier = await tx.subscriptionTier.update({
          where: { id: trial.id },
          data: {
            status: SubscriptionStatus.ACTIVE,
            stripeSubscriptionId: stripeSubscription.id,
            trialConvertedAt: new Date(),
            billingCycle,
          },
        });

        await tx.trialEvent.create({
          data: {
            organizationId,
            eventType: 'trial_converted',
            metadata: JSON.stringify({
              stripeSubscriptionId: stripeSubscription.id,
              billingCycle,
            }),
            occurredAt: new Date(),
          },
        });

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

    const events = await this.prisma.trialEvent.findMany({
      where: {
        eventType: 'trial_expired',
        occurredAt: {
          gte: yesterday,
        },
      },
      orderBy: {
        occurredAt: 'desc',
      },
    });

    const results: Array<{
      organizationId: string;
      organizationName: string;
      contactEmail: string | null;
    }> = [];

    for (const event of events) {
      const org = await this.prisma.organization.findUnique({
        where: { id: event.organizationId },
        select: { name: true, contactEmail: true },
      });

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
