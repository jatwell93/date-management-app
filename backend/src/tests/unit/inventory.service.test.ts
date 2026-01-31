import { InventoryService } from '../../services/inventory.service';
import { getDb } from '../../database';

jest.mock('../../database');

describe('InventoryService', () => {
  let inventoryService: InventoryService;
  let mockDb: any;
  let mockStatement: any;

  beforeEach(() => {
    inventoryService = new InventoryService();
    mockStatement = {
      run: jest.fn(),
      get: jest.fn(),
      all: jest.fn(),
    };
    mockDb = {
      prepare: jest.fn(() => mockStatement),
    };
    (getDb as jest.Mock).mockReturnValue(mockDb);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should create a new inventory item', async () => {
    const newItemData = {
      productId: 1,
      expiryDate: '2025-12-31',
      locationId: 1,
      status: 'Normal' as 'Normal' | 'Markdown 1' | 'Markdown 2' | 'Markdown 3' | 'Expired',
    };
    (mockDb.prepare as jest.Mock).mockReturnValue(mockStatement);
    (mockStatement.run as jest.Mock).mockReturnValue({ lastInsertRowid: 1 });

    const createdItem = await inventoryService.createInventoryItem(newItemData, 1);

    expect(createdItem).toEqual(
      expect.objectContaining({
        id: 1,
        ...newItemData,
      }),
    );
    expect(getDb).toHaveBeenCalledTimes(1);
    expect(mockDb.prepare).toHaveBeenCalledWith(
      'INSERT INTO inventory_items (product_id, expiry_date, location_id, status) VALUES (?, ?, ?, ?)',
    );
    expect(mockStatement.run).toHaveBeenCalledWith(
      newItemData.productId,
      newItemData.expiryDate,
      newItemData.locationId,
      newItemData.status,
    );
  });

  it('should update an inventory item status', async () => {
    (mockDb.prepare as jest.Mock).mockReturnValue(mockStatement);
    (mockStatement.run as jest.Mock).mockReturnValue({ changes: 1 });
    (mockStatement.get as jest.Mock).mockReturnValue({ id: 1, status: 'Markdown 1' });

    const updatedItem = await inventoryService.updateInventoryItem(1, { status: 'Markdown 1' }, 1);

    expect(updatedItem).not.toBeNull();
    expect(updatedItem?.status).toBe('Markdown 1');
    expect(getDb).toHaveBeenCalledTimes(2);
    expect(mockDb.prepare).toHaveBeenCalledWith(
      `UPDATE inventory_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    );
    expect(mockStatement.run).toHaveBeenCalledWith('Markdown 1', 1);
  });

  it('should return null if no item was updated', async () => {
    (mockDb.prepare as jest.Mock).mockReturnValue(mockStatement);
    (mockStatement.run as jest.Mock).mockReturnValue({ changes: 0 });
    (mockStatement.get as jest.Mock).mockReturnValue(null);

    const updatedItem = await inventoryService.updateInventoryItem(999, { status: 'Expired' }, 1);

    expect(updatedItem).toBeNull();
    expect(getDb).toHaveBeenCalledTimes(2);
    expect(mockDb.prepare).toHaveBeenCalledWith(
      `UPDATE inventory_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    );
    expect(mockStatement.run).toHaveBeenCalledWith('Expired', 999);
  });

  describe('calculateMarkdownStatusSync', () => {
    it('should return "Expired" for dates in the past', () => {
      const date = new Date();
      date.setDate(date.getDate() - 1);
      const expiryDate = date.toISOString().split('T')[0];
      expect(inventoryService.calculateMarkdownStatusSync(expiryDate)).toBe('Expired');
    });

    it('should return "Markdown 3" for dates within the next 7 days', () => {
      const date = new Date();
      date.setDate(date.getDate() + 7);
      const expiryDate = date.toISOString().split('T')[0];
      expect(inventoryService.calculateMarkdownStatusSync(expiryDate)).toBe('Markdown 3');
    });

    it("should return 'Markdown 2' for dates between 8 and 14 days from now", () => {
      const date = new Date();
      date.setDate(date.getDate() + 14);
      const expiryDate = date.toISOString().split('T')[0];
      expect(inventoryService.calculateMarkdownStatusSync(expiryDate)).toBe('Markdown 2');
    });

    it("should return 'Markdown 1' for dates between 15 and 30 days from now", () => {
      const date = new Date();
      date.setDate(date.getDate() + 30);
      const expiryDate = date.toISOString().split('T')[0];
      expect(inventoryService.calculateMarkdownStatusSync(expiryDate)).toBe('Markdown 1');
    });

    it('should return "Normal" for dates more than 30 days from now', () => {
      const date = new Date();
      date.setDate(date.getDate() + 31);
      const expiryDate = date.toISOString().split('T')[0];
      expect(inventoryService.calculateMarkdownStatusSync(expiryDate)).toBe('Normal');
    });
  });
});
