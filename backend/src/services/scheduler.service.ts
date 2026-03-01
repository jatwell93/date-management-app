import cron from 'node-cron';
import { InventoryService } from './inventory.service';
import { getDb } from '../database';
import { DatabaseBackupService } from './database.backup.service';
import { startStripeSyncJob } from '../jobs/stripe-sync.job';
import { startTrialExpirationJob } from '../jobs/trialExpiration.job';
import { startDunningJob } from '../jobs/dunning.job';

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

    // Initialize trial expiration job (runs daily at 00:00 UTC)
    // Handles: expired trial downgrade, reminder emails, downgrade warnings
    startTrialExpirationJob();

    // Initialize dunning job (runs daily at 01:00 UTC)
    // Handles: auto-downgrade past_due subscriptions after 7-day grace period
    startDunningJob();

    // Initialize Stripe sync job (runs hourly)
    startStripeSyncJob();
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
