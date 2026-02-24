"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulerService = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const inventory_service_1 = require("./inventory.service");
const database_1 = require("../database");
const database_backup_service_1 = require("./database.backup.service");
const subscription_service_1 = require("./subscription.service");
const email_service_1 = require("./email.service");
class SchedulerService {
    // Initialize scheduled tasks
    static initialize() {
        // Schedule the markdown update to run daily at 2:00 AM
        // This is a good time when system load is typically low
        node_cron_1.default.schedule('0 2 * * *', () => {
            console.log('Running scheduled markdown updates...');
            this.updateAllInventoryMarkdownStatuses();
        });
        // Schedule database backups to run daily at 1:00 AM
        // This is a good time when system load is typically low
        node_cron_1.default.schedule('0 1 * * *', () => {
            console.log('Running scheduled database backup...');
            this.createDatabaseBackup();
        });
        // Schedule trial expiration job daily at 00:00 UTC
        // Handles: expired trial downgrade, reminder emails, downgrade warnings
        node_cron_1.default.schedule('0 0 * * *', () => {
            console.log('Running trial expiration job...');
            this.runTrialExpirationJob();
        });
    }
    // Trial expiration job: downgrade expired trials, send reminders
    static async runTrialExpirationJob() {
        const subscriptionService = new subscription_service_1.SubscriptionService();
        const emailService = new email_service_1.EmailService();
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
                    }
                    catch (error) {
                        console.error(`Failed to send downgrade warning for org ${trial.organizationId}:`, String(error));
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
                    console.log(`Sent trial reminder to org ${trial.organizationId}: ${trial.daysRemaining} days remaining`);
                }
                catch (error) {
                    console.error(`Failed to send reminder for org ${trial.organizationId}:`, String(error));
                }
            }
            console.log('Trial expiration job completed successfully');
        }
        catch (error) {
            console.error('Trial expiration job failed:', String(error));
        }
    }
    // Update markdown statuses for all inventory items
    static async updateAllInventoryMarkdownStatuses() {
        try {
            // Get all inventory items from the database
            const db = (0, database_1.getDb)();
            const inventoryItems = db
                .prepare('SELECT id, expiry_date FROM inventory_items')
                .all();
            console.log(`Processing ${inventoryItems.length} inventory items for markdown updates...`);
            // Process each inventory item
            for (const item of inventoryItems) {
                try {
                    await this.inventoryService.autoCalculateMarkdownStatus(item.id, item.expiry_date);
                }
                catch (error) {
                    console.error(`Error updating markdown status for item ${item.id}:`, error);
                }
            }
            console.log('Completed scheduled markdown updates.');
        }
        catch (error) {
            console.error('Error in scheduled markdown update process:', error);
        }
    }
    // Create a database backup
    static async createDatabaseBackup() {
        try {
            const backupPath = await this.databaseBackupService.createBackup();
            console.log(`Database backup completed: ${backupPath}`);
        }
        catch (error) {
            console.error('Error in scheduled database backup process:', error);
        }
    }
}
exports.SchedulerService = SchedulerService;
SchedulerService.inventoryService = new inventory_service_1.InventoryService();
SchedulerService.databaseBackupService = new database_backup_service_1.DatabaseBackupService();
