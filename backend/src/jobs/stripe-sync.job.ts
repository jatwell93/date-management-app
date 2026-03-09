/**
 * Stripe Subscription Sync Job
 *
 * Runs hourly to reconcile local subscription_tiers table against Stripe's API.
 * Detects divergences (e.g. tier mismatch, status mismatch) and updates local state.
 * Logs warnings for any divergences found.
 *
 * Schedule: Every hour at minute 0 (0 * * * *)
 *
 * 16A.B.4: Implements required hourly Stripe state sync.
 */

import cron, { ScheduledTask } from 'node-cron';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { envConfig } from '../config/environment';
import { Logger } from '../utils/logger';
import * as Sentry from '@sentry/node';

let cronJob: ScheduledTask | null = null;

// Tier extraction — mirrors webhook.service.ts logic
function extractTierFromStripeSubscription(subscription: Stripe.Subscription): string {
  const price = subscription.items.data[0]?.price;
  if (!price) return 'starter';
  const tier = price.metadata?.tier as string | undefined;
  const validTiers = ['starter', 'professional', 'premium', 'concierge'];
  return tier && validTiers.includes(tier) ? tier : 'starter';
}

// Normalize Stripe status to local status string
function normalizeStatus(stripeStatus: Stripe.Subscription.Status): string {
  switch (stripeStatus) {
    case 'active':
      return 'active';
    case 'canceled':
      return 'canceled';
    case 'past_due':
      return 'past_due';
    case 'trialing':
      return 'trialing';
    default:
      return 'active';
  }
}

/**
 * Core sync logic — exported for testability with injected dependencies.
 */
export async function runStripeSyncJob(prisma: PrismaClient, stripeClient: Stripe): Promise<void> {
  Logger.info('Starting hourly Stripe subscription sync job');

  try {
    // Step 1: Fetch all local subscriptions that have a Stripe subscription ID
    const localSubscriptions = await prisma.subscriptionTier.findMany({
      where: {
        stripeSubscriptionId: { not: null },
      },
      select: {
        id: true,
        organizationId: true,
        stripeSubscriptionId: true,
        tierLevel: true,
        status: true,
      },
    });

    if (localSubscriptions.length === 0) {
      Logger.info('No local Stripe-linked subscriptions found, skipping sync');
      return;
    }

    // Step 2: Fetch all subscriptions from Stripe (paginated)
    const stripeSubscriptionMap = new Map<string, Stripe.Subscription>();

    let startingAfter: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const page = await stripeClient.subscriptions.list({
        status: 'all',
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      for (const sub of page.data) {
        stripeSubscriptionMap.set(sub.id, sub);
      }

      hasMore = page.has_more;
      if (hasMore && page.data.length > 0) {
        startingAfter = page.data[page.data.length - 1].id;
      }
    }

    Logger.info(`Fetched ${stripeSubscriptionMap.size} subscriptions from Stripe`);

    // Step 3: Compare and sync
    let syncCount = 0;
    let divergenceCount = 0;

    for (const local of localSubscriptions) {
      const stripeId = local.stripeSubscriptionId;
      if (!stripeId) {
        Logger.warn('Skipping local subscription with missing Stripe subscription id', {
          organizationId: local.organizationId,
          localStatus: local.status,
        });
        continue;
      }

      const stripeSub = stripeSubscriptionMap.get(stripeId);

      if (!stripeSub) {
        // Subscription not found in Stripe — log warning, do NOT auto-delete
        Logger.warn('Local subscription not found in Stripe during sync', {
          organizationId: local.organizationId,
          stripeSubscriptionId: stripeId,
          localStatus: local.status,
        });
        divergenceCount++;
        continue;
      }

      const stripeTier = extractTierFromStripeSubscription(stripeSub);
      const stripeStatus = normalizeStatus(stripeSub.status);
      const stripeTrialEnd = stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null;

      const tierMismatch = local.tierLevel !== stripeTier;
      const statusMismatch = local.status !== stripeStatus;

      if (tierMismatch || statusMismatch) {
        Logger.warn('Subscription divergence detected — syncing from Stripe', {
          organizationId: local.organizationId,
          stripeSubscriptionId: stripeId,
          localTier: local.tierLevel,
          stripeTier,
          localStatus: local.status,
          stripeStatus,
        });

        await prisma.subscriptionTier.updateMany({
          where: { stripeSubscriptionId: stripeId },
          data: {
            tierLevel: stripeTier,
            status: stripeStatus,
            trialEndDate: stripeTrialEnd,
          },
        });

        divergenceCount++;
        syncCount++;
      }
    }

    Logger.info('Hourly Stripe sync completed', {
      checkedCount: localSubscriptions.length,
      divergenceCount,
      syncCount,
    });

    if (divergenceCount > 0) {
      Logger.warn(`Stripe sync: ${divergenceCount} divergences found, ${syncCount} corrected`);
    }
  } catch (error) {
    Logger.error('Stripe sync job failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    Sentry.captureException(error, {
      level: 'error',
      tags: { job: 'stripe_sync', component: 'scheduler' },
    });

    // Do NOT rethrow — cron job should not stop on single failure
  }
}

/**
 * Start the hourly Stripe sync cron job
 */
export function startStripeSyncJob(): void {
  if (cronJob) {
    Logger.warn('Stripe sync job already running');
    return;
  }

  if (!envConfig.STRIPE_SECRET_KEY) {
    Logger.warn('STRIPE_SECRET_KEY not set — Stripe sync job will not start');
    return;
  }

  const prisma = getDefaultDatabaseClient();
  const stripeClient = new Stripe(envConfig.STRIPE_SECRET_KEY, {
    apiVersion: '2023-08-16',
  });

  // Schedule: Every hour at minute 0
  cronJob = cron.schedule('0 * * * *', async () => {
    await runStripeSyncJob(prisma as unknown as PrismaClient, stripeClient);
  });

  Logger.info('Stripe subscription sync job started (hourly at :00)');
}

export function stopStripeSyncJob(): void {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    Logger.info('Stripe sync job stopped');
  }
}
