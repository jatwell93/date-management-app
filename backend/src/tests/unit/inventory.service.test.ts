import { InventoryService } from '../../services/inventory.service';
import { PrismaClient } from '@prisma/client';

describe('InventoryService', () => {
  let inventoryService: InventoryService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      inventoryItem: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(mockPrisma)),
    };
    inventoryService = new InventoryService(mockPrisma as unknown as PrismaClient);
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

    // The service might expect Dates in return from Prisma
    const mockCreatedItem = {
      id: 1,
      ...newItemData,
      expiryDate: new Date(newItemData.expiryDate), // Prisma returns Date objects
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockPrisma.inventoryItem.create.mockResolvedValue(mockCreatedItem);

    const createdItem = await inventoryService.createInventoryItem(newItemData, 1);

    expect(createdItem.id).toBe(1);
    expect(createdItem.status).toBe('Normal');
    expect(mockPrisma.inventoryItem.create).toHaveBeenCalled();
  });

  it('should update an inventory item status', async () => {
    const mockItem = {
      id: 1,
      productId: 1,
      locationId: 1,
      expiryDate: new Date(),
      status: 'Markdown 1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // We mock findUnique to return the item (if logic checks existence first)
    mockPrisma.inventoryItem.findUnique.mockResolvedValue(mockItem);
    // We mock update to return the updated item
    mockPrisma.inventoryItem.update.mockResolvedValue({
      ...mockItem,
      status: 'Markdown 1',
    });

    const updatedItem = await inventoryService.updateInventoryItem(1, { status: 'Markdown 1' }, 1);

    expect(updatedItem).not.toBeNull();
    expect(updatedItem?.status).toBe('Markdown 1');
    expect(mockPrisma.inventoryItem.update).toHaveBeenCalled();
  });

  it('should return null if no item was updated', async () => {
    // If logic checks existence via findUnique first:
    mockPrisma.inventoryItem.findUnique.mockResolvedValue(null);

    const updatedItem = await inventoryService.updateInventoryItem(999, { status: 'Expired' }, 1);

    expect(updatedItem).toBeNull();
    // Assuming implementation checks existence
    expect(mockPrisma.inventoryItem.findUnique).toHaveBeenCalledWith({ where: { id: 999 } });
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
