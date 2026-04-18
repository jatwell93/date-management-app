import { getDb, releaseDb } from '../../database';
import { ExpiredItemService } from '../../services/expired-item.service';

jest.mock('../../database', () => ({
  getDb: jest.fn(),
  releaseDb: jest.fn(),
}));

function createMockDb() {
  return {
    prepare: jest.fn(),
    transaction: jest.fn((callback: () => unknown) => () => callback()),
  };
}

describe('ExpiredItemService', () => {
  let service: ExpiredItemService;
  let mockDb: ReturnType<typeof createMockDb>;
  const mockGetDb = getDb as unknown as jest.Mock;
  const mockReleaseDb = releaseDb as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
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

      mockDb.prepare.mockReturnValue({ all: jest.fn().mockReturnValue(rows) });

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
          return { get: jest.fn().mockReturnValue(undefined) };
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
            get: jest.fn().mockReturnValue({ id: 1, product_id: 1, costPrice: 5 }),
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
            get: jest.fn().mockReturnValue({ id: 1, product_id: 1, costPrice: 5 }),
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
      const selectGet = jest
        .fn()
        .mockReturnValue({ id: 3, product_id: 10, location_id: 2, costPrice: 2.5 });
      const insertRun = jest.fn().mockReturnValue({ lastInsertRowid: BigInt(41) });
      const auditRun = jest.fn();
      const updateRun = jest.fn();

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
        if (sql.includes("UPDATE inventory_items SET status = 'Processed' WHERE id = ?")) {
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
      expect(new Date(result.transactionDate).toString()).not.toBe('Invalid Date');

      expect(insertRun).toHaveBeenCalledWith(3, 7, 'sold_through', null, null);
      expect(auditRun).toHaveBeenCalledWith(7, 3, 'Expired item marked as sold through');
      expect(updateRun).toHaveBeenCalledWith(3);
      expect(mockReleaseDb).toHaveBeenCalledWith(mockDb);
    });

    it('creates expired transaction with calculated financial loss', async () => {
      const selectGet = jest
        .fn()
        .mockReturnValue({ id: 5, product_id: 10, location_id: 2, costPrice: 4 });
      const insertRun = jest.fn().mockReturnValue({ lastInsertRowid: 9 });
      const auditRun = jest.fn();
      const updateRun = jest.fn();

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
        if (sql.includes("UPDATE inventory_items SET status = 'Processed' WHERE id = ?")) {
          return { run: updateRun };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      });

      const result = await service.processExpiredItem(5, 11, 'expired', 3);

      expect(result.id).toBe(9);
      expect(result.unitsDiscarded).toBe(3);
      expect(result.financialLoss).toBe(12);
      expect(insertRun).toHaveBeenCalledWith(5, 11, 'expired', 3, 12);
      expect(auditRun).toHaveBeenCalledWith(
        11,
        5,
        'Expired item marked as discarded, units: 3, financial loss: 12',
      );
      expect(updateRun).toHaveBeenCalledWith(5);
      expect(mockReleaseDb).toHaveBeenCalledWith(mockDb);
    });
  });

  describe('getFinancialLossesBySKU', () => {
    it('returns grouped financial losses by sku', async () => {
      const rows = [{ sku: 'SKU-1', productName: 'Milk', totalLoss: 15 }];
      mockDb.prepare.mockReturnValue({ all: jest.fn().mockReturnValue(rows) });

      const result = await service.getFinancialLossesBySKU();

      expect(result).toEqual(rows);
      expect(mockReleaseDb).toHaveBeenCalledWith(mockDb);
    });
  });

  describe('getFinancialLossesByStoreArea', () => {
    it('returns grouped financial losses by store area', async () => {
      const rows = [{ locationName: 'Cool Room', totalLoss: 20 }];
      mockDb.prepare.mockReturnValue({ all: jest.fn().mockReturnValue(rows) });

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

      mockDb.prepare.mockReturnValue({ all: jest.fn().mockReturnValue(rows) });

      const result = await service.getAllExpiredItemTransactions();

      expect(result).toEqual(rows);
      expect(mockReleaseDb).toHaveBeenCalledWith(mockDb);
    });
  });
});
