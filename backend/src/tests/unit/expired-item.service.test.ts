import { getDb, releaseDb } from '../../database';
import { ExpiredItemService } from '../../services/expired-item.service';
import {
  DISPOSITIONED_STATUSES,
  EXPIRED_WORKLIST_STATUSES,
  SQLITE_PROCESSED_STATUS,
} from '../../../../shared/domain/disposition';

vi.mock('../../database', () => ({
  getDb: vi.fn(),
  releaseDb: vi.fn(),
}));

function createMockDb() {
  return {
    prepare: vi.fn(),
    transaction: vi.fn((callback: () => unknown) => () => callback()),
  };
}

describe('ExpiredItemService', () => {
  let service: ExpiredItemService;
  let mockDb: ReturnType<typeof createMockDb>;
  const mockGetDb = getDb as unknown as jest.Mock;
  const mockReleaseDb = releaseDb as unknown as jest.Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ExpiredItemService();
    mockDb = createMockDb();
    mockGetDb.mockReturnValue(mockDb);
  });

  describe('getAllExpiredItems', () => {
    it('returns expired items from the query result', async () => {
      const rows = [
        {
          id: 1,
          expiryDate: '2026-04-10',
          sku: 'SKU-1',
          productName: 'Milk',
          costPrice: 12,
          locationName: 'Cool Room',
          status: 'Expired',
          quantityAvailable: 3,
        },
      ];

      mockDb.prepare.mockReturnValue({ all: vi.fn().mockReturnValue(rows) });

      const result = await service.getAllExpiredItems();

      expect(result).toEqual(rows);
      expect(mockReleaseDb).toHaveBeenCalledWith(mockDb);
    });

    it('releases db connection when query throws', async () => {
      mockDb.prepare.mockImplementation(() => {
        throw new Error('query failed');
      });

      await expect(service.getAllExpiredItems()).rejects.toThrow('query failed');
      expect(mockReleaseDb).toHaveBeenCalledWith(mockDb);
    });
  });

  describe('processExpiredItem', () => {
    it('throws when inventory item does not exist', async () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT ii.*, p.cost_price as costPrice')) {
          return { get: vi.fn().mockReturnValue(undefined) };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      });

      await expect(service.processExpiredItem(99, 7, 'sold_through')).rejects.toThrow(
        'Inventory item with ID 99 not found',
      );

      expect(mockReleaseDb).toHaveBeenCalledWith(mockDb);
    });

    it('throws when expired action is missing unitsDiscarded', async () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT ii.*, p.cost_price as costPrice')) {
          return {
            get: vi.fn().mockReturnValue({ id: 1, product_id: 1, costPrice: 5 }),
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      });

      await expect(service.processExpiredItem(1, 7, 'expired')).rejects.toThrow(
        'Units discarded must be a positive number when marking as expired',
      );

      expect(mockReleaseDb).toHaveBeenCalledWith(mockDb);
    });

    it('throws when expired action has non-positive unitsDiscarded', async () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT ii.*, p.cost_price as costPrice')) {
          return {
            get: vi.fn().mockReturnValue({ id: 1, product_id: 1, costPrice: 5 }),
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      });

      await expect(service.processExpiredItem(1, 7, 'expired', 0)).rejects.toThrow(
        'Units discarded must be a positive number when marking as expired',
      );

      expect(mockReleaseDb).toHaveBeenCalledWith(mockDb);
    });

    it('creates sold-through transaction with null loss fields', async () => {
      const selectGet = vi
        .fn()
        .mockReturnValue({ id: 3, product_id: 10, location_id: 2, costPrice: 2.5 });
      const insertRun = vi.fn().mockReturnValue({ lastInsertRowid: BigInt(41) });
      const auditRun = vi.fn();
      const updateRun = vi.fn();

      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT ii.*, p.cost_price as costPrice')) {
          return { get: selectGet };
        }
        if (sql.includes('INSERT INTO expired_item_transactions')) {
          return { run: insertRun };
        }
        if (sql.includes('INSERT INTO audit_log')) {
          return { run: auditRun };
        }
        if (sql.includes('UPDATE inventory_items SET status = ? WHERE id IN (?)')) {
          return { run: updateRun };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      });

      const result = await service.processExpiredItem(3, 7, 'sold_through');

      expect(result.id).toBe(41);
      expect(result.inventoryItemId).toBe(3);
      expect(result.userId).toBe(7);
      expect(result.action).toBe('sold_through');
      expect(result.unitsDiscarded).toBeNull();
      expect(result.financialLoss).toBeNull();
      expect(result.markdownLevel).toBeNull();
      expect(new Date(result.transactionDate).toString()).not.toBe('Invalid Date');

      expect(insertRun).toHaveBeenCalledWith(3, 7, 'sold_through', null, null, null);
      expect(auditRun).toHaveBeenCalledWith(7, 3, 'Expired item marked as sold through');
      expect(updateRun).toHaveBeenCalledWith(SQLITE_PROCESSED_STATUS, 3);
      expect(mockReleaseDb).toHaveBeenCalledWith(mockDb);
    });

    it('creates expired transaction with calculated financial loss', async () => {
      const selectGet = vi
        .fn()
        .mockReturnValue({ id: 5, product_id: 10, location_id: 2, costPrice: 4 });
      const insertRun = vi.fn().mockReturnValue({ lastInsertRowid: 9 });
      const auditRun = vi.fn();
      const updateRun = vi.fn();

      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT ii.*, p.cost_price as costPrice')) {
          return { get: selectGet };
        }
        if (
          sql.includes('WHERE ii.product_id = ?') &&
          sql.includes('ORDER BY ii.expiry_date ASC')
        ) {
          return { all: vi.fn().mockReturnValue([{ id: 5 }, { id: 6 }, { id: 7 }]) };
        }
        if (sql.includes('INSERT INTO expired_item_transactions')) {
          return { run: insertRun };
        }
        if (sql.includes('INSERT INTO audit_log')) {
          return { run: auditRun };
        }
        if (sql.includes('UPDATE inventory_items SET status = ?') && sql.includes('WHERE id IN')) {
          return { run: updateRun };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      });

      const result = await service.processExpiredItem(5, 11, 'expired', 3);

      expect(result.id).toBe(9);
      expect(result.unitsDiscarded).toBe(3);
      expect(result.financialLoss).toBe(12);
      expect(result.markdownLevel).toBeNull();
      expect(insertRun).toHaveBeenCalledWith(5, 11, 'expired', 3, 12, null);
      expect(auditRun).toHaveBeenCalledWith(
        11,
        5,
        'Expired item marked as discarded, units: 3, financial loss: 12',
      );
      expect(updateRun).toHaveBeenCalledWith(SQLITE_PROCESSED_STATUS, 5, 6, 7);
      expect(mockReleaseDb).toHaveBeenCalledWith(mockDb);
    });

    it('processes the requested number of matching expired rows oldest first with one ledger row', async () => {
      const representative = {
        id: 5,
        product_id: 10,
        location_id: 2,
        costPrice: 4,
        expiry_date: '2026-04-01',
      };
      const matchingRows = [{ id: 5 }, { id: 6 }, { id: 7 }];
      const selectRepresentative = vi.fn().mockReturnValue(representative);
      const selectMatchingRows = vi.fn().mockReturnValue(matchingRows);
      const insertRun = vi.fn().mockReturnValue({ lastInsertRowid: 9 });
      const auditRun = vi.fn();
      const updateRun = vi.fn();

      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT ii.*, p.cost_price as costPrice')) {
          return { get: selectRepresentative };
        }
        if (
          sql.includes('WHERE ii.product_id = ?') &&
          sql.includes('ORDER BY ii.expiry_date ASC')
        ) {
          return { all: selectMatchingRows };
        }
        if (sql.includes('INSERT INTO expired_item_transactions')) {
          return { run: insertRun };
        }
        if (sql.includes('INSERT INTO audit_log')) {
          return { run: auditRun };
        }
        if (sql.includes('UPDATE inventory_items SET status = ?') && sql.includes('WHERE id IN')) {
          return { run: updateRun };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      });

      const result = await service.processExpiredItem(5, 11, 'expired', 3);

      expect(result.unitsDiscarded).toBe(3);
      expect(result.financialLoss).toBe(12);
      expect(selectMatchingRows).toHaveBeenCalledWith(
        10,
        2,
        4,
        ...EXPIRED_WORKLIST_STATUSES,
        ...DISPOSITIONED_STATUSES,
        3,
      );
      expect(insertRun).toHaveBeenCalledWith(5, 11, 'expired', 3, 12, null);
      expect(auditRun).toHaveBeenCalledWith(
        11,
        5,
        'Expired item marked as discarded, units: 3, financial loss: 12',
      );
      expect(updateRun).toHaveBeenCalledWith(SQLITE_PROCESSED_STATUS, 5, 6, 7);
    });

    it('records the full entered quantity when it exceeds the matching rows (over-count write-off)', async () => {
      // The scan flow only logs SKU + expiry markers, so a pool can represent more
      // physical units than it has rows. Entering 3 when 2 marker rows match must
      // record the full 3 units in the ledger and dispose the 2 rows, not reject. #268
      const selectRepresentative = vi.fn().mockReturnValue({
        id: 5,
        product_id: 10,
        location_id: 2,
        costPrice: 4,
        expiry_date: '2026-04-01',
      });
      const selectMatchingRows = vi.fn().mockReturnValue([{ id: 5 }, { id: 6 }]);
      const insertRun = vi.fn().mockReturnValue({ lastInsertRowid: 9 });
      const auditRun = vi.fn();
      const updateRun = vi.fn();

      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT ii.*, p.cost_price as costPrice')) {
          return { get: selectRepresentative };
        }
        if (
          sql.includes('WHERE ii.product_id = ?') &&
          sql.includes('ORDER BY ii.expiry_date ASC')
        ) {
          return { all: selectMatchingRows };
        }
        if (sql.includes('INSERT INTO expired_item_transactions')) {
          return { run: insertRun };
        }
        if (sql.includes('INSERT INTO audit_log')) {
          return { run: auditRun };
        }
        if (sql.includes('UPDATE inventory_items SET status = ?') && sql.includes('WHERE id IN')) {
          return { run: updateRun };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      });

      const result = await service.processExpiredItem(5, 11, 'expired', 3);

      // Ledger records the entered quantity (3) and its loss (3 * cost 4 = 12),
      // independent of the 2 marker rows actually present.
      expect(result.unitsDiscarded).toBe(3);
      expect(result.financialLoss).toBe(12);
      expect(insertRun).toHaveBeenCalledWith(5, 11, 'expired', 3, 12, null);
      // Only the two real marker rows are dispositioned.
      expect(updateRun).toHaveBeenCalledWith(SQLITE_PROCESSED_STATUS, 5, 6);
    });

    it('rejects an expired write-off when no matching rows remain in the worklist', async () => {
      const selectRepresentative = vi.fn().mockReturnValue({
        id: 5,
        product_id: 10,
        location_id: 2,
        costPrice: 4,
        expiry_date: '2026-04-01',
      });
      const selectMatchingRows = vi.fn().mockReturnValue([]);

      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT ii.*, p.cost_price as costPrice')) {
          return { get: selectRepresentative };
        }
        if (
          sql.includes('WHERE ii.product_id = ?') &&
          sql.includes('ORDER BY ii.expiry_date ASC')
        ) {
          return { all: selectMatchingRows };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      });

      await expect(service.processExpiredItem(5, 11, 'expired', 3)).rejects.toThrow(
        'Cannot discard 3 units; no expired units are available to process',
      );
    });

    it('snapshots the markdown level from the item expiry date on sold-through', async () => {
      // 10 days from expiry => Markdown 3 window (0-30 days) per the report bucketing.
      const expiryDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const selectGet = vi.fn().mockReturnValue({
        id: 8,
        product_id: 10,
        location_id: 2,
        costPrice: 2,
        expiry_date: expiryDate,
      });
      const insertRun = vi.fn().mockReturnValue({ lastInsertRowid: 55 });

      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT ii.*, p.cost_price as costPrice')) {
          return { get: selectGet };
        }
        if (sql.includes('INSERT INTO expired_item_transactions')) {
          return { run: insertRun };
        }
        if (sql.includes('INSERT INTO audit_log')) {
          return { run: vi.fn() };
        }
        if (sql.includes('UPDATE inventory_items SET status = ? WHERE id IN (?)')) {
          return { run: vi.fn() };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      });

      const result = await service.processExpiredItem(8, 7, 'sold_through');

      expect(result.markdownLevel).toBe(3);
      expect(insertRun).toHaveBeenCalledWith(8, 7, 'sold_through', null, null, 3);
    });
  });

  describe('getFinancialLossesBySKU', () => {
    it('returns grouped financial losses by sku', async () => {
      const rows = [{ sku: 'SKU-1', productName: 'Milk', totalLoss: 15 }];
      mockDb.prepare.mockReturnValue({ all: vi.fn().mockReturnValue(rows) });

      const result = await service.getFinancialLossesBySKU();

      expect(result).toEqual(rows);
      expect(mockReleaseDb).toHaveBeenCalledWith(mockDb);
    });
  });

  describe('getFinancialLossesByStoreArea', () => {
    it('returns grouped financial losses by store area', async () => {
      const rows = [{ locationName: 'Cool Room', totalLoss: 20 }];
      mockDb.prepare.mockReturnValue({ all: vi.fn().mockReturnValue(rows) });

      const result = await service.getFinancialLossesByStoreArea();

      expect(result).toEqual(rows);
      expect(mockReleaseDb).toHaveBeenCalledWith(mockDb);
    });
  });

  describe('getAllExpiredItemTransactions', () => {
    it('returns transaction history ordered by transaction date', async () => {
      const rows = [
        {
          id: 100,
          inventoryItemId: 12,
          userId: 8,
          action: 'expired',
          unitsDiscarded: 2,
          financialLoss: 6,
          transactionDate: '2026-04-11T00:00:00.000Z',
        },
      ];

      mockDb.prepare.mockReturnValue({ all: vi.fn().mockReturnValue(rows) });

      const result = await service.getAllExpiredItemTransactions();

      expect(result).toEqual(rows);
      expect(mockReleaseDb).toHaveBeenCalledWith(mockDb);
    });
  });
});
