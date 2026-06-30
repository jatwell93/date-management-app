import { getDb, releaseDb } from '../database';
import { InventoryItem } from '../models/inventory-item.model';
import {
  DISPOSITIONED_STATUSES,
  EXPIRED_WORKLIST_STATUSES,
  SQLITE_PROCESSED_STATUS,
} from '../../../shared/domain/disposition';
import { getMarkdownLevelForDays } from '../../../shared/domain/markdown';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Whole days from today until the given expiry date (date-only, UTC-normalised so
 * results are deterministic regardless of the time of day). Returns null for
 * missing/invalid dates.
 */
function daysToExpiry(expiryDate: string | null | undefined, now = new Date()): number | null {
  if (!expiryDate) {
    return null;
  }
  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) {
    return null;
  }
  const expiryUtc = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((expiryUtc - nowUtc) / MS_PER_DAY);
}

/**
 * Markdown level snapshot aligned with the expiry report windows
 * (Markdown 1 = 61-90 days, Markdown 2 = 31-60, Markdown 3 = 0-30 days to expiry).
 * Returns null when not within a markdown window (already expired or >90 days out).
 * Note: distinct from inventory-markdown.helpers (7/14/30 day) thresholds; this
 * matches the reporting windows so sell-through reporting lines up.
 */
function reportMarkdownLevel(
  expiryDate: string | null | undefined,
  now = new Date(),
): number | null {
  const days = daysToExpiry(expiryDate, now);
  return getMarkdownLevelForDays(days);
}

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
  markdownLevel: number | null;
  transactionDate: string;
}

export class ExpiredItemService {
  /**
   * Get all expired items
   */
  async getAllExpiredItems(): Promise<ExpiredItem[]> {
    const db = getDb();
    try {
      // Worklist eligibility mirrors the Workers/Neon path (shared constants):
      // past-expiry stock OR markdown stock not yet expired, excluding anything
      // already dispositioned. Keeping the two backends on EXPIRED_WORKLIST_STATUSES
      // prevents the matcher below from rejecting rows the worklist surfaces.
      const statusPlaceholders = EXPIRED_WORKLIST_STATUSES.map(() => '?').join(', ');
      const dispositionedPlaceholders = DISPOSITIONED_STATUSES.map(() => '?').join(', ');
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
        WHERE (ii.expiry_date < date('now') OR ii.status IN (${statusPlaceholders}))
          AND ii.status NOT IN (${dispositionedPlaceholders})
        GROUP BY ii.product_id, ii.location_id, p.cost_price
        ORDER BY ii.expiry_date ASC
      `;

      const items = db
        .prepare(query)
        .all(...EXPIRED_WORKLIST_STATUSES, ...DISPOSITIONED_STATUSES) as ExpiredItem[];
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
        // The query selects `ii.*` (snake_case columns) plus an aliased costPrice,
        // so type the raw row shape it actually returns rather than the camelCase model.
        const inventoryItem = itemStmt.get(inventoryItemId) as
          | (InventoryItem & {
              product_id: number;
              location_id: number;
              costPrice: number;
              expiry_date: string;
            })
          | undefined;

        if (!inventoryItem) {
          throw new Error(`Inventory item with ID ${inventoryItemId} not found`);
        }

        let inventoryItemIdsToProcess = [inventoryItemId];

        if (action === 'expired') {
          if (
            unitsDiscarded === undefined ||
            !Number.isInteger(unitsDiscarded) ||
            unitsDiscarded <= 0
          ) {
            throw new Error('Units discarded must be a positive number when marking as expired');
          }

          // Must accept the same statuses the worklist surfaces (shared constants),
          // otherwise a markdown row shown to the user can't be written off.
          const statusPlaceholders = EXPIRED_WORKLIST_STATUSES.map(() => '?').join(', ');
          const dispositionedPlaceholders = DISPOSITIONED_STATUSES.map(() => '?').join(', ');
          const matchingRowsStmt = db.prepare(`
            SELECT ii.id
            FROM inventory_items ii
            JOIN products p ON ii.product_id = p.id
            WHERE ii.product_id = ?
              AND ii.location_id = ?
              AND p.cost_price = ?
              AND (ii.expiry_date < date('now') OR ii.status IN (${statusPlaceholders}))
              AND ii.status NOT IN (${dispositionedPlaceholders})
            ORDER BY ii.expiry_date ASC, ii.id ASC
            LIMIT ?
          `);
          const matchingRows = matchingRowsStmt.all(
            inventoryItem.product_id,
            inventoryItem.location_id,
            inventoryItem.costPrice,
            ...EXPIRED_WORKLIST_STATUSES,
            ...DISPOSITIONED_STATUSES,
            unitsDiscarded,
          ) as Array<{ id: number }>;

          if (matchingRows.length < unitsDiscarded) {
            throw new Error(
              `Cannot discard ${unitsDiscarded} units; only ${matchingRows.length} expired units are available`,
            );
          }

          inventoryItemIdsToProcess = matchingRows.map((row) => row.id);
        }

        // Calculate financial loss if marking as expired
        let financialLoss: number | null = null;
        if (action === 'expired' && unitsDiscarded !== undefined) {
          financialLoss = unitsDiscarded * inventoryItem.costPrice;
        }

        // Snapshot the markdown level the item was at when dispositioned, so
        // sell-through reporting can tell at which reduction depth stock moved.
        const markdownLevel = reportMarkdownLevel(inventoryItem.expiry_date);

        // Create the expired item transaction record
        const insertTransactionStmt = db.prepare(`
          INSERT INTO expired_item_transactions
          (inventory_item_id, user_id, action, units_discarded, financial_loss, markdown_level)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        const result = insertTransactionStmt.run(
          inventoryItemId,
          userId,
          action,
          action === 'expired' ? unitsDiscarded : null,
          financialLoss,
          markdownLevel,
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
        const placeholders = inventoryItemIdsToProcess.map(() => '?').join(', ');
        const updateStmt = db.prepare(
          `UPDATE inventory_items SET status = ? WHERE id IN (${placeholders})`,
        );
        updateStmt.run(SQLITE_PROCESSED_STATUS, ...inventoryItemIdsToProcess);

        // Return the created transaction record
        return {
          id: Number(result.lastInsertRowid),
          inventoryItemId,
          userId,
          action,
          unitsDiscarded: action === 'expired' ? unitsDiscarded || null : null,
          financialLoss,
          markdownLevel,
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
          eit.markdown_level as markdownLevel,
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
