import cron from 'node-cron';
import { InventoryService } from './inventory.service';
import { getDb } from '../database';
import { DatabaseBackupService } from './database.backup.service';
import { SubscriptionService } from './subscription.service';
import { EmailService } from './email.service';
import { startStripeSyncJob } from '../jobs/stripe-sync.job';

export class SchedulerService {
  private static databaseBackupService = new DatabaseBackupService();

  // Initialize scheduled tasks
  static initialize() {
    // Schedule the markdown update to run daily at 2:00 AM
    // This is a good time when system load is typically low
    cron.schedule('0 2 * * *', () => {
      console.log('Running scheduled markdown updates...');
      this.updateAllInventoryMarkdownStatuses();
    });

    // Schedule database backups to run daily at 1:00 AM
    // This is a good time when system load is typically low
    cron.schedule('0 1 * * *', () => {
      console.log('Running scheduled database backup...');
      this.createDatabaseBackup();
    });

    // Schedule trial expiration job daily at 00:00 UTC
    // Handles: expired trial downgrade, reminder emails, downgrade warnings
    cron.schedule('0 0 * * *', () => {
      console.log('Running trial expiration job...');
      this.runTrialExpirationJob();
    });

    // Schedule hourly Stripe subscription sync (16A.B.4)
    // Fetches all Stripe subscriptions and reconciles against local subscription_tiers
    cron.schedule('0 * * * *', () => {
      console.log('Running hourly Stripe subscription sync...');
      // Actual sync logic handled by stripe-sync.job module
    });

    startStripeSyncJob();
  }

  // Trial expiration job: downgrade expired trials, send reminders
  static async runTrialExpirationJob() {
    const subscriptionService = new SubscriptionService();
    const emailService = new EmailService();

    console.log('Starting trial expiration job');

    try {
      // Step 1: Downgrade expired trials to starter tier
      const downgradedCount = await subscriptionService.downgradeExpiredTrials();
      console.log(`Downgraded ${downgradedCount} expired trials to starter tier`);

      // Step 2: Send downgrade warning emails
      if (downgradedCount > 0) {
        const recentDowngrades = await subscriptionService.getRecentlyDowngradedTrials();
        for (const trial of recentDowngrades) {
          try {
            await emailService.sendDowngradeWarningEmail(trial.organizationId, 0, 500);
          } catch (error) {
            console.error(
              `Failed to send downgrade warning for org ${trial.organizationId}:`,
              String(error),
            );
          }
        }
      }

      // Step 3: Find and send trial reminder emails
      const trialsNeedingReminders = await subscriptionService.findTrialsNeedingReminders();
      console.log(`Found ${trialsNeedingReminders.length} trials needing reminders`);

      for (const trial of trialsNeedingReminders) {
        try {
          await emailService.sendTrialReminderEmail(trial.organizationId, trial.daysRemaining);
          await subscriptionService.logTrialEvent(trial.organizationId, 'trial_reminder_sent', {
            daysRemaining: trial.daysRemaining,
          });
          console.log(
            `Sent trial reminder to org ${trial.organizationId}: ${trial.daysRemaining} days remaining`,
          );
        } catch (error) {
          console.error(`Failed to send reminder for org ${trial.organizationId}:`, String(error));
        }
      }

      console.log('Trial expiration job completed successfully');
    } catch (error) {
      console.error('Trial expiration job failed:', String(error));
    }
  }

  // Update markdown statuses for all inventory items across all organizations
  static async updateAllInventoryMarkdownStatuses() {
    try {
      // Get all organizations
      const db = getDb();
      const organizations = db.prepare('SELECT id FROM organizations').all() as Array<{
        id: string;
      }>;

      console.log(`Processing markdown updates for ${organizations.length} organizations...`);

      const orgResults: Array<{ orgId: string; total: number; failed: number; errors: string[] }> =
        [];

      // Process each organization
      for (const org of organizations) {
        const orgResult = { orgId: org.id, total: 0, failed: 0, errors: [] as string[] };

        try {
          const inventoryService = new InventoryService(org.id);
          const rawInventoryItems = db
            .prepare('SELECT id, expiry_date FROM inventory_items WHERE organization_id = ?')
            .all(org.id) as Array<{ id: number; expiry_date: string }>;

          const inventoryItems = rawInventoryItems.map((item) => ({
            id: item.id,
            expiryDate: item.expiry_date,
          }));

          console.log(
            `Processing ${inventoryItems.length} inventory items for organization ${org.id}...`,
          );

          orgResult.total = inventoryItems.length;

          // Process items in bulk for better performance
          try {
            await inventoryService.bulkUpdateMarkdownStatuses(inventoryItems);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            // If bulk update fails, fall back to individual updates with retry
            console.warn(
              `Bulk update failed for organization ${org.id}, falling back to individual updates:`,
              error,
            );

            for (const item of inventoryItems) {
              let retries = 0;
              const maxRetries = 2;

              while (retries <= maxRetries) {
                try {
                  await inventoryService.autoCalculateMarkdownStatus(item.id, item.expiryDate);
                  break; // Success, exit retry loop
                } catch (error) {
                  if (retries === maxRetries) {
                    // Final retry failed, record the error
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    const errorMsg = `Failed to update markdown status for item ${item.id} after ${maxRetries + 1} attempts: ${errorMessage}`;
                    console.error(errorMsg);
                    orgResult.errors.push(errorMsg);
                    orgResult.failed++;
                  } else {
                    // Wait before retry (exponential backoff)
                    const delayMs = Math.pow(2, retries) * 100; // 100ms, 200ms, 400ms
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                    retries++;
                  }
                }
              }
            }
          }

          // Log organization summary
          if (orgResult.failed > 0) {
            console.warn(
              `Organization ${org.id} completed with ${orgResult.failed}/${orgResult.total} failures`,
            );
            // Log first few errors for debugging
            orgResult.errors.slice(0, 3).forEach((error) => console.warn(`  - ${error}`));
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const orgError = `Critical error processing organization ${org.id}: ${errorMessage}`;
          console.error(orgError);
          orgResult.errors.push(orgError);
          orgResult.failed = orgResult.total; // Mark all as failed
        }

        orgResults.push(orgResult);
      }

      // Summary report
      const totalItems = orgResults.reduce((sum, r) => sum + r.total, 0);
      const totalFailed = orgResults.reduce((sum, r) => sum + r.failed, 0);
      const successRate =
        totalItems > 0 ? (((totalItems - totalFailed) / totalItems) * 100).toFixed(1) : '100';

      console.log(`\nMarkdown update summary:`);
      console.log(`- Total organizations: ${organizations.length}`);
      console.log(`- Total items processed: ${totalItems}`);
      console.log(`- Total failures: ${totalFailed}`);
      console.log(`- Success rate: ${successRate}%`);

      if (totalFailed > 0) {
        console.warn(`\n${totalFailed} items failed to update. Check logs for details.`);

        // Optionally send alert for high failure rates
        const failureRate = totalFailed / totalItems;
        if (failureRate > 0.1) {
          // More than 10% failure rate
          console.error(
            `High failure rate detected (${(failureRate * 100).toFixed(1)}%). Consider manual intervention.`,
          );
        }
      }

      console.log('Completed scheduled markdown updates for all organizations.');
    } catch (error) {
      console.error('Error in scheduled markdown update process:', error);
    }
  }

  // Create a database backup
  static async createDatabaseBackup() {
    try {
      const backupPath = await this.databaseBackupService.createBackup();
      console.log(`Database backup completed: ${backupPath}`);
    } catch (error) {
      console.error('Error in scheduled database backup process:', error);
    }
  }
}
