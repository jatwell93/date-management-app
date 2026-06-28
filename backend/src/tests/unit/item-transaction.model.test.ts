const mockGetDb = vi.fn();
const mockPrepare = vi.fn();
const mockRun = vi.fn();

vi.mock('../../database', () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
}));

import {
  createItemTransaction,
  itemTransactionsTable,
  ItemTransaction,
} from '../../models/item-transaction.model';

describe('item-transaction model helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({ run: mockRun });
    mockGetDb.mockReturnValue({ prepare: mockPrepare });
  });

  it('exposes table metadata used by migration helpers', () => {
    expect(itemTransactionsTable.name).toBe('item_transactions');
    expect(itemTransactionsTable.columns).toMatchObject({
      id: 'id',
      inventory_item_id: 'inventory_item_id',
      user_id: 'user_id',
      type: 'type',
      quantity_change: 'quantity_change',
      transaction_date: 'transaction_date',
      notes: 'notes',
    });
    expect(itemTransactionsTable.creationSchema).toContain(
      'CREATE TABLE IF NOT EXISTS item_transactions',
    );
  });

  it('inserts a transaction row and returns numeric last insert id', () => {
    mockRun.mockReturnValue({ lastInsertRowid: 44n });

    const transaction: ItemTransaction = {
      organizationId: 'org-1',
      inventory_item_id: 101,
      user_id: 7,
      type: 'in',
      quantity_change: 5,
      transaction_date: '2026-04-12T10:00:00.000Z',
      notes: 'initial count',
    };

    const insertedId = createItemTransaction(transaction);

    expect(mockPrepare).toHaveBeenCalledWith(
      'INSERT INTO item_transactions (inventory_item_id, user_id, type, quantity_change, notes) VALUES (?, ?, ?, ?, ?)',
    );
    expect(mockRun).toHaveBeenCalledWith(101, 7, 'in', 5, 'initial count');
    expect(insertedId).toBe(44);
  });

  it('handles numeric sqlite row ids without conversion issues', () => {
    mockRun.mockReturnValue({ lastInsertRowid: 12 });

    const insertedId = createItemTransaction({
      organizationId: 'org-2',
      inventory_item_id: 9,
      user_id: 2,
      type: 'adjustment',
      quantity_change: -1,
      transaction_date: '2026-04-12T11:00:00.000Z',
      notes: 'correction',
    });

    expect(insertedId).toBe(12);
  });
});
