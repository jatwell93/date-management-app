/**
 * Trial Expiration Job
 *
 * Scheduled job that runs daily to:
 * 1. Downgrade expired trials to the permanent Free tier
 * 2. Send trial reminder emails (10, 5, 2 days before expiry)
 * 3. Send downgrade warning emails
 *
 * Schedule: Daily at 00:00 UTC (0 0 * * *)
 */

import cron, { ScheduledTask } from 'node-cron';
import { SubscriptionService } from '../services/subscription.service';
import { EmailService } from '../services/email.service';
import { Logger } from '../utils/logger';
import * as Sentry from '@sentry/node';

let cronJob: ScheduledTask | null = null;

export function startTrialExpirationJob(): void {
  if (cronJob) {
    Logger.warn('Trial expiration job already running');
    return;
  }

  // Schedule: Daily at 00:00 UTC
  cronJob = cron.schedule('0 0 * * *', async () => {
    await runTrialExpirationJob();
  });

  Logger.info('Trial expiration job started (daily at 00:00 UTC)');
}

export function stopTrialExpirationJob(): void {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    Logger.info('Trial expiration job stopped');
  }
}

export async function runTrialExpirationJob(): Promise<void> {
  const subscriptionService = new SubscriptionService();
  const emailService = new EmailService();

  Logger.info('Starting trial expiration job');

  try {
    // Step 1: Downgrade expired trials to the permanent Free tier
    Logger.info('Checking for expired trials to downgrade...');
    const downgradedCount = await subscriptionService.downgradeExpiredTrials();
    Logger.info(`Downgraded ${downgradedCount} expired trials to free tier`);

    // Step 2: Send downgrade warning emails to recently downgraded
    if (downgradedCount > 0) {
      // Get organizations that were just downgraded (last 24 hours)
      const recentDowngrades = await subscriptionService.getRecentlyDowngradedTrials();
      for (const trial of recentDowngrades) {
        try {
          await emailService.sendDowngradeWarningEmail(
            trial.organizationId,
            0, // We don't have current usage, assume within limits
            500, // Starter tier limit
          );
        } catch (error) {
          Logger.error(
            `Failed to send downgrade warning for org ${trial.organizationId}: ${String(error)}`,
          );
          Sentry.captureException(error, {
            level: 'error',
            tags: { job: 'trial-expiration', event: 'downgrade-warning-email' },
            extra: { organizationId: trial.organizationId },
          });
        }
      }
    }

    // Step 3: Find trials needing reminder emails
    Logger.info('Checking for trials needing reminders...');
    const trialsNeedingReminders = await subscriptionService.findTrialsNeedingReminders();
    Logger.info(`Found ${trialsNeedingReminders.length} trials needing reminders`);

    // Step 4: Send reminder emails
    for (const trial of trialsNeedingReminders) {
      try {
        await emailService.sendTrialReminderEmail(trial.organizationId, trial.daysRemaining);

        // Log the reminder event
        await subscriptionService.logTrialEvent(trial.organizationId, 'trial_reminder_sent', {
          daysRemaining: trial.daysRemaining,
        });

        Logger.info(
          `Sent trial reminder to org ${trial.organizationId}: ${trial.daysRemaining} days remaining`,
        );
      } catch (error) {
        Logger.error(`Failed to send reminder for org ${trial.organizationId}: ${String(error)}`);
        Sentry.captureException(error, {
          level: 'error',
          tags: { job: 'trial-expiration', event: 'trial-reminder-email' },
          extra: { organizationId: trial.organizationId, daysRemaining: trial.daysRemaining },
        });
        // Continue with other reminders even if one fails
      }
    }

    Logger.info('Trial expiration job completed successfully');
  } catch (error) {
    Logger.error(`Trial expiration job failed: ${String(error)}`);
    Sentry.captureException(error, {
      level: 'error',
      tags: { job: 'trial-expiration', event: 'job-failure' },
    });
    // Don't rethrow - we don't want the cron job to stop on error
  }
}

// Run immediately if called directly (for testing)
if (require.main === module) {
  runTrialExpirationJob().catch((error) => {
    Logger.error(`Failed to run trial expiration job: ${String(error)}`);
    process.exit(1);
  });
}
