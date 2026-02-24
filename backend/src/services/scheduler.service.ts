import cron from 'node-cron';
import { InventoryService } from './inventory.service';
import { getDb } from '../database';
import { DatabaseBackupService } from './database.backup.service';
import { SubscriptionService } from './subscription.service';
import { EmailService } from './email.service';

export class SchedulerService {
  private static inventoryService = new InventoryService();
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

  // Update markdown statuses for all inventory items
  static async updateAllInventoryMarkdownStatuses() {
    try {
      // Get all inventory items from the database
      const db = getDb();
      const inventoryItems = db
        .prepare('SELECT id, expiry_date FROM inventory_items')
        .all() as Array<{ id: number; expiry_date: string }>;

      console.log(`Processing ${inventoryItems.length} inventory items for markdown updates...`);

      // Process each inventory item
      for (const item of inventoryItems) {
        try {
          await this.inventoryService.autoCalculateMarkdownStatus(item.id, item.expiry_date);
        } catch (error) {
          console.error(`Error updating markdown status for item ${item.id}:`, error);
        }
      }

      console.log('Completed scheduled markdown updates.');
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
