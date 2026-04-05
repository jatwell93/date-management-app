import { getDb, releaseDb } from '../database';
import { InventoryItem } from '../models/inventory-item.model';

export interface ExpiredItem {
  id: number;
  expiryDate: string;
  sku: string;
  productName: string;
  costPrice: number;
  locationName: string;
  status: string;
  quantityAvailable: number;
}

export interface ExpiredItemTransaction {
  id: number;
  inventoryItemId: number;
  userId: number;
  action: 'sold_through' | 'expired';
  unitsDiscarded: number | null;
  financialLoss: number | null;
  transactionDate: string;
}

export class ExpiredItemService {
  /**
   * Get all expired items
   */
  async getAllExpiredItems(): Promise<ExpiredItem[]> {
    const db = getDb();
    try {
      // Query to get all items with 'Expired' status
      // Group by product and location to get quantity
      const query = `
        SELECT 
          ii.id,
          ii.expiry_date as expiryDate,
          p.sku,
          p.name AS productName,
          p.cost_price as costPrice,
          sa.name AS locationName,
          ii.status,
          COUNT(ii.id) AS quantityAvailable
        FROM inventory_items ii
        JOIN products p ON ii.product_id = p.id
        JOIN store_areas sa ON ii.location_id = sa.id
        WHERE ii.status = 'Expired'
        GROUP BY ii.product_id, ii.location_id, p.cost_price
        ORDER BY ii.expiry_date ASC
      `;

      const items = db.prepare(query).all() as ExpiredItem[];
      return items;
    } finally {
      releaseDb(db);
    }
  }

  /**
   * Process an expired item as either 'sold through' or 'expired'
   */
  async processExpiredItem(
    inventoryItemId: number,
    userId: number,
    action: 'sold_through' | 'expired',
    unitsDiscarded?: number,
  ): Promise<ExpiredItemTransaction> {
    const db = getDb();
    try {
      // Start a transaction
      const transactionCapableDb = db as typeof db & {
        transaction<T>(callback: () => T): () => T;
      };

      const transaction = transactionCapableDb.transaction(() => {
        // Get the inventory item to validate and get cost price
        const itemStmt = db.prepare(`
          SELECT ii.*, p.cost_price as costPrice
          FROM inventory_items ii
          JOIN products p ON ii.product_id = p.id
          WHERE ii.id = ?
        `);
        const inventoryItem = itemStmt.get(inventoryItemId) as
          | (InventoryItem & { costPrice: number })
          | undefined;

        if (!inventoryItem) {
          throw new Error(`Inventory item with ID ${inventoryItemId} not found`);
        }

        if (action === 'expired') {
          // Validate unitsDiscarded is provided and is positive
          if (unitsDiscarded === undefined || unitsDiscarded <= 0) {
            throw new Error('Units discarded must be a positive number when marking as expired');
          }

          // Check if there's sufficient quantity available (we're only checking if at least 1 exists)
          // Since we're processing individual items, we expect there to be 1 instance
        }

        // Calculate financial loss if marking as expired
        let financialLoss: number | null = null;
        if (action === 'expired' && unitsDiscarded !== undefined) {
          financialLoss = unitsDiscarded * inventoryItem.costPrice;
        }

        // Create the expired item transaction record
        const insertTransactionStmt = db.prepare(`
          INSERT INTO expired_item_transactions 
          (inventory_item_id, user_id, action, units_discarded, financial_loss) 
          VALUES (?, ?, ?, ?, ?)
        `);

        const result = insertTransactionStmt.run(
          inventoryItemId,
          userId,
          action,
          action === 'expired' ? unitsDiscarded : null,
          financialLoss,
        ) as {
          lastInsertRowid: number | bigint;
        };

        // Create audit log entry
        const changeDescription =
          action === 'sold_through'
            ? `Expired item marked as sold through`
            : `Expired item marked as discarded, units: ${unitsDiscarded}, financial loss: ${financialLoss}`;

        const auditStmt = db.prepare(`
          INSERT INTO audit_log (user_id, inventory_item_id, change_description) 
          VALUES (?, ?, ?)
        `);
        auditStmt.run(userId, inventoryItemId, changeDescription);

        // Update the inventory item's status to 'Processed' to remove it from the expired list
        // but keep it for reporting purposes.
        const updateStmt = db.prepare(
          "UPDATE inventory_items SET status = 'Processed' WHERE id = ?",
        );
        updateStmt.run(inventoryItemId);

        // Return the created transaction record
        return {
          id: Number(result.lastInsertRowid),
          inventoryItemId,
          userId,
          action,
          unitsDiscarded: action === 'expired' ? unitsDiscarded || null : null,
          financialLoss,
          transactionDate: new Date().toISOString(),
        };
      });

      return transaction();
    } finally {
      releaseDb(db);
    }
  }

  /**
   * Get financial losses by SKU
   */
  async getFinancialLossesBySKU(): Promise<
    Array<{ sku: string; productName: string; totalLoss: number }>
  > {
    const db = getDb();
    try {
      const query = `
        SELECT 
          p.sku,
          p.name AS productName,
          SUM(eit.financial_loss) AS totalLoss
        FROM expired_item_transactions eit
        JOIN inventory_items ii ON eit.inventory_item_id = ii.id
        JOIN products p ON ii.product_id = p.id
        WHERE eit.action = 'expired'
        GROUP BY p.id
        ORDER BY totalLoss DESC
      `;

      return db.prepare(query).all() as Array<{
        sku: string;
        productName: string;
        totalLoss: number;
      }>;
    } finally {
      releaseDb(db);
    }
  }

  /**
   * Get financial losses by store area
   */
  async getFinancialLossesByStoreArea(): Promise<
    Array<{ locationName: string; totalLoss: number }>
  > {
    const db = getDb();
    try {
      const query = `
        SELECT 
          sa.name AS locationName,
          SUM(eit.financial_loss) AS totalLoss
        FROM expired_item_transactions eit
        JOIN inventory_items ii ON eit.inventory_item_id = ii.id
        JOIN store_areas sa ON ii.location_id = sa.id
        WHERE eit.action = 'expired'
        GROUP BY sa.id
        ORDER BY totalLoss DESC
      `;

      return db.prepare(query).all() as Array<{ locationName: string; totalLoss: number }>;
    } finally {
      releaseDb(db);
    }
  }

  /**
   * Get all expired item transactions for audit trail
   */
  async getAllExpiredItemTransactions(): Promise<ExpiredItemTransaction[]> {
    const db = getDb();
    try {
      const query = `
        SELECT 
          eit.id,
          eit.inventory_item_id as inventoryItemId,
          eit.user_id as userId,
          eit.action,
          eit.units_discarded as unitsDiscarded,
          eit.financial_loss as financialLoss,
          eit.transaction_date as transactionDate
        FROM expired_item_transactions eit
        ORDER BY eit.transaction_date DESC
      `;

      return db.prepare(query).all() as ExpiredItemTransaction[];
    } finally {
      releaseDb(db);
    }
  }
}
