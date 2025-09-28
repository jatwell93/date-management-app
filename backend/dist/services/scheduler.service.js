"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulerService = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const inventory_service_1 = require("./inventory.service");
const database_1 = require("../database");
class SchedulerService {
    // Initialize scheduled tasks
    static initialize() {
        // Schedule the markdown update to run daily at 2:00 AM
        // This is a good time when system load is typically low
        node_cron_1.default.schedule('0 2 * * *', () => {
            console.log('Running scheduled markdown updates...');
            this.updateAllInventoryMarkdownStatuses();
        });
        // Additional: You could also run it more frequently (e.g. every hour during business hours)
        // cron.schedule('0 9-17 * * *', () => { // Every hour from 9 AM to 5 PM
        //   console.log('Running hourly markdown updates...');
        //   this.updateAllInventoryMarkdownStatuses();
        // });
    }
    // Update markdown statuses for all inventory items
    static async updateAllInventoryMarkdownStatuses() {
        try {
            // Get all inventory items from the database
            const db = await (0, database_1.getDb)();
            const inventoryItems = await db.all('SELECT id, expiry_date FROM inventory_items');
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
}
exports.SchedulerService = SchedulerService;
SchedulerService.inventoryService = new inventory_service_1.InventoryService();
