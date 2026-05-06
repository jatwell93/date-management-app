import cron from 'node-cron';
import { Logger } from '../utils/logger';
import { InventoryService } from './inventory.service';
import { getDb } from '../database';
import { DatabaseBackupService } from './database.backup.service';
import { startStripeSyncJob } from '../jobs/stripe-sync.job';
import { startTrialExpirationJob } from '../jobs/trialExpiration.job';
import { startDunningJob } from '../jobs/dunning.job';

export class SchedulerService {
  private static databaseBackupService = new DatabaseBackupService();

  private static async retryMarkdownUpdateForItem(
    inventoryService: InventoryService,
    item: { id: number; expiryDate: string },
    maxRetries = 2,
  ): Promise<string | null> {
    let retries = 0;

    while (retries <= maxRetries) {
      try {
        await inventoryService.autoCalculateMarkdownStatus(item.id, item.expiryDate);
        return null;
      } catch (error) {
        if (retries === maxRetries) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return `Failed to update markdown status for item ${item.id} after ${maxRetries + 1} attempts: ${errorMessage}`;
        }

        const delayMs = Math.pow(2, retries) * 100;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        retries++;
      }
    }

    return null;
  }

  // Initialize scheduled tasks
  static initialize() {
    if (process.env.DISABLE_SCHEDULER_JOBS === 'true') {
      Logger.info('Scheduler jobs are disabled by DISABLE_SCHEDULER_JOBS');
      return;
    }

    // Schedule the markdown update to run daily at 2:00 AM
    // This is a good time when system load is typically low
    cron.schedule('0 2 * * *', () => {
      Logger.info('Running scheduled markdown updates...');
      this.updateAllInventoryMarkdownStatuses();
    });

    // Schedule database backups to run daily at 1:00 AM
    // This is a good time when system load is typically low
    cron.schedule('0 1 * * *', () => {
      Logger.info('Running scheduled database backup...');
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

      Logger.info(`Processing markdown updates for ${organizations.length} organizations...`);

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

          Logger.debug(`Processing ${inventoryItems.length} inventory items for organization ${org.id}...`);

          orgResult.total = inventoryItems.length;

          // Process items in bulk for better performance
          try {
            await inventoryService.bulkUpdateMarkdownStatuses(inventoryItems);
          } catch (error) {
            // If bulk update fails, fall back to individual updates with retry
            Logger.warn(`Bulk update failed for organization ${org.id}, falling back to individual updates:`, { error: error instanceof Error ? error.message : String(error) });

            for (const item of inventoryItems) {
              const itemError = await this.retryMarkdownUpdateForItem(inventoryService, item);
              if (itemError) {
                Logger.error(itemError);
                orgResult.errors.push(itemError);
                orgResult.failed++;
              }
            }
          }

          // Log organization summary
          if (orgResult.failed > 0) {
            Logger.warn(`Organization ${org.id} completed with ${orgResult.failed}/${orgResult.total} failures`, { errors: orgResult.errors.slice(0, 3) });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const orgError = `Critical error processing organization ${org.id}: ${errorMessage}`;
          Logger.error(orgError);
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

      Logger.info('Markdown update summary', { organizations: organizations.length, totalItems, totalFailed, successRate: `${successRate}%` });

      if (totalFailed > 0) {
        Logger.warn(`${totalFailed} items failed to update. Check logs for details.`, { totalFailed });

        // Optionally send alert for high failure rates
        const failureRate = totalFailed / totalItems;
        if (failureRate > 0.1) {
          // More than 10% failure rate
          Logger.error(`High failure rate detected (${(failureRate * 100).toFixed(1)}%). Consider manual intervention.`);
        }
      }

      Logger.info('Completed scheduled markdown updates for all organizations.');
    } catch (error) {
      Logger.error('Error in scheduled markdown update process', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  // Create a database backup
  static async createDatabaseBackup() {
    try {
      const backupPath = await this.databaseBackupService.createBackup();
      Logger.info(`Database backup completed: ${backupPath}`);
    } catch (error) {
      Logger.error('Error in scheduled database backup process', { error: error instanceof Error ? error.message : String(error) });
    }
  }
}
