/**
 * Dunning Job
 *
 * Scheduled job that runs daily to:
 * 1. Find subscriptions past_due for more than 7 days
 * 2. Auto-downgrade them to Starter tier
 * 3. Apply creation locks if usage exceeds Starter limits
 * 4. Send Sentry fatal escalation alerts
 *
 * Schedule: Daily at 01:00 UTC (0 1 * * *)
 * Runs after trial expiration job to avoid conflicts
 */

import cron, { ScheduledTask } from 'node-cron';
import { SubscriptionService } from '../services/subscription.service';
import { Logger } from '../utils/logger';
import * as Sentry from '@sentry/node';

let cronJob: ScheduledTask | null = null;

export function startDunningJob(): void {
  if (cronJob) {
    Logger.warn('Dunning job already running');
    return;
  }

  // Schedule: Daily at 02:00 UTC (1 hour after database backup at 01:00 UTC)
  cronJob = cron.schedule('0 2 * * *', async () => {
    await runDunningJob();
  });

  Logger.info('Dunning job started (daily at 02:00 UTC)');
}

export function stopDunningJob(): void {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    Logger.info('Dunning job stopped');
  }
}

export async function runDunningJob(): Promise<void> {
  const subscriptionService = new SubscriptionService();

  Logger.info('Starting dunning job - checking for past_due subscriptions > 7 days');

  try {
    // Find and downgrade expired past_due subscriptions
    const downgradedCount = await subscriptionService.downgradeExpiredPastDue();

    if (downgradedCount > 0) {
      Logger.warn(`Dunning job: Auto-downgraded ${downgradedCount} organizations to Starter tier`);

      // Send aggregate alert to Sentry
      Sentry.captureMessage(
        `[DUNNING] Batch auto-downgrade completed: ${downgradedCount} organizations downgraded to Starter after 7-day grace period`,
        {
          level: 'fatal',
          tags: { component: 'dunning', event: 'batch_downgrade' },
          extra: {
            downgradedCount,
            gracePeriodDays: 7,
            runTimestamp: new Date().toISOString(),
          },
        },
      );
    } else {
      Logger.info('Dunning job: No organizations eligible for auto-downgrade');
    }

    Logger.info('Dunning job completed successfully');
  } catch (error) {
    Logger.error(`Dunning job failed: ${String(error)}`);
    Sentry.captureException(error, {
      level: 'error',
      tags: { component: 'dunning', event: 'job_failure' },
    });
    // Don't rethrow - we don't want the cron job to stop on error
  }
}

// Run immediately if called directly (for testing)
if (require.main === module) {
  runDunningJob().catch((error) => {
    Logger.error(`Failed to run dunning job: ${String(error)}`);
    process.exit(1);
  });
}
