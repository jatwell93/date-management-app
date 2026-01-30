import { type Database as DatabaseType } from 'better-sqlite3';
import { Migration } from './migration.service';

/**
 * Migration to add expired_item_transactions table
 * This table tracks all transactions related to expired inventory items
 */
export const expiredItemTransactionsMigration: Migration = {
  id: 7,
  name: '007-add-expired-item-transactions-table',
  up: (db: DatabaseType) => {
    // Create the expired_item_transactions table
    db.exec(`
      CREATE TABLE IF NOT EXISTS expired_item_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        inventory_item_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        action TEXT NOT NULL, -- 'sold_through' or 'expired'
        units_discarded INTEGER, -- Only required when action is 'expired'
        financial_loss REAL, -- Calculated as units_discarded * cost_price
        transaction_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (inventory_item_id) REFERENCES inventory_items (id),
        FOREIGN KEY (user_id) REFERENCES users (id)
      );
      
      -- Create indexes for performance
      CREATE INDEX IF NOT EXISTS idx_expired_item_transactions_inventory_item_id ON expired_item_transactions (inventory_item_id);
      CREATE INDEX IF NOT EXISTS idx_expired_item_transactions_user_id ON expired_item_transactions (user_id);
      CREATE INDEX IF NOT EXISTS idx_expired_item_transactions_action ON expired_item_transactions (action);
      CREATE INDEX IF NOT EXISTS idx_expired_item_transactions_transaction_date ON expired_item_transactions (transaction_date);
    `);
  },
  down: (db: DatabaseType) => {
    // Drop the expired_item_transactions table
    db.exec(`
      DROP TABLE IF EXISTS expired_item_transactions;
    `);
  },
};
