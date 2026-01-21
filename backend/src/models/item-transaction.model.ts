
import { INTEGER, TEXT, REAL } from '../utils/sql-data-types';

export interface ItemTransaction {
  id?: number;
  inventory_item_id: number;
  user_id: number;
  type: 'in' | 'out' | 'adjustment';
  quantity_change: number;
  transaction_date: string;
  notes?: string;
}

export const itemTransactionsTable = {
  name: 'item_transactions',
  columns: {
    id: 'id',
    inventory_item_id: 'inventory_item_id',
    user_id: 'user_id',
    type: 'type',
    quantity_change: 'quantity_change',
    transaction_date: 'transaction_date',
    notes: 'notes',
  },
  creationSchema: `
    CREATE TABLE IF NOT EXISTS item_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventory_item_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('in', 'out', 'adjustment')),
      quantity_change REAL NOT NULL,
      transaction_date TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
      notes TEXT,
      FOREIGN KEY (inventory_item_id) REFERENCES inventory_items (id),
      FOREIGN KEY (user_id) REFERENCES users (id)
    );
  `,
};


