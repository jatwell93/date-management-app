import { InventoryService } from '../../services/inventory.service';
import { PrismaClient } from '@prisma/client';

function createMockPrisma() {
  const mockPrisma = {
    inventoryItem: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    product: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    storeArea: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    itemTransaction: {
      create: vi.fn(),
    },
    organizationUsage: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    subscriptionTier: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback(mockPrisma)),
  };

  return mockPrisma;
}

function createInventoryRepositoryMock(mockPrisma: any) {
  return {
    findFirst: vi.fn((where) => mockPrisma.inventoryItem.findFirst({ where })),
    findAll: vi.fn((orgId) =>
      mockPrisma.inventoryItem.findMany({ where: { organizationId: orgId } }),
    ),
    findById: vi.fn((id, orgId) =>
      mockPrisma.inventoryItem.findFirst({ where: { id, organizationId: orgId } }),
    ),
    findByProductId: vi.fn((productId, orgId) =>
      mockPrisma.inventoryItem.findMany({
        where: { productId, organizationId: orgId },
      }),
    ),
    findRecentByProductId: vi.fn((productId, orgId, limit) =>
      mockPrisma.inventoryItem.findMany({
        where: { productId, organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ),
    findByLocationId: vi.fn((locationId, orgId) =>
      mockPrisma.inventoryItem.findMany({
        where: { locationId, organizationId: orgId },
      }),
    ),
    findByOrganizationIdAndId: vi.fn((id, orgId) =>
      mockPrisma.inventoryItem.findFirst({ where: { id, organizationId: orgId } }),
    ),
    findManyByIds: vi.fn((ids, orgId) =>
      mockPrisma.inventoryItem.findMany({
        where: { id: { in: ids }, organizationId: orgId },
        select: { id: true },
      }),
    ),
    findUniqueWithProduct: vi.fn((id, orgId) =>
      mockPrisma.inventoryItem.findUnique({
        where: { id, organizationId: orgId },
        include: { product: { select: { costPrice: true } } },
      }),
    ),
    updateManyByIds: vi.fn((items) =>
      Promise.all(
        items.map((item) =>
          mockPrisma.inventoryItem.update({
            where: { id: item.id },
            data: { status: item.status },
          }),
        ),
      ),
    ),
    create: vi.fn((data) => mockPrisma.inventoryItem.create({ data })),
    update: vi.fn((id, orgId, data) =>
      mockPrisma.inventoryItem.update({ where: { id, organizationId: orgId }, data }),
    ),
    delete: vi.fn((id, orgId) =>
      mockPrisma.inventoryItem.delete({ where: { id, organizationId: orgId } }),
    ),
  };
}

function createProductRepositoryMock(mockPrisma: any) {
  return {
    findById: vi.fn((id, orgId) =>
      mockPrisma.product.findFirst({ where: { id, organizationId: orgId } }),
    ),
    findBySku: vi.fn((sku, orgId) =>
      mockPrisma.product.findFirst({ where: { sku, organizationId: orgId } }),
    ),
    create: vi.fn((data) => mockPrisma.product.create({ data })),
    update: vi.fn((id, orgId, data) =>
      mockPrisma.product.update({ where: { id, organizationId: orgId }, data }),
    ),
  };
}

function createInventoryService(organizationId: string, mockPrisma: any): InventoryService {
  return new InventoryService(
    organizationId,
    mockPrisma as unknown as PrismaClient,
    createInventoryRepositoryMock(mockPrisma) as any,
    createProductRepositoryMock(mockPrisma) as any,
    {
      findUsageByOrganizationId: vi.fn((orgId) =>
        mockPrisma.organizationUsage.findUnique({ where: { organizationId: orgId } }),
      ),
      updateUsage: vi.fn((orgId, data) =>
        mockPrisma.organizationUsage.update({ where: { organizationId: orgId }, data }),
      ),
    } as any,
    {
      findById: vi.fn((id, orgId) =>
        mockPrisma.user.findFirst({ where: { id, organizationId: orgId } }),
      ),
      findByEmailAndOrganizationId: mockPrisma.user.findFirst,
      createClerkUser: mockPrisma.user.create,
      updateManyByClerkUserId: mockPrisma.user.updateMany,
      findFirstByClerkUserIdAndOrganizationId: mockPrisma.user.findFirst,
      softDeleteById: mockPrisma.user.update,
      findByClerkUserIdSelectEmail: mockPrisma.user.findFirst,
      findUniqueByClerkUserId: mockPrisma.user.findUnique,
      findAdminByOrganizationId: mockPrisma.user.findFirst,
      findRecentTrialUserByEmail: mockPrisma.user.findFirst,
    } as any,
    {
      create: vi.fn((data) => mockPrisma.auditLog.create({ data })),
    } as any,
    {
      findById: vi.fn((id, orgId) =>
        mockPrisma.storeArea.findFirst({ where: { id, organizationId: orgId } }),
      ),
    } as any,
  );
}

function createRepositoryDelegationService(
  organizationId: string,
  mockPrisma: any,
  inventoryRepo: Record<string, jest.Mock>,
): InventoryService {
  return new InventoryService(
    organizationId,
    mockPrisma as unknown as PrismaClient,
    inventoryRepo as never,
  );
}

describe('InventoryService', () => {
  let inventoryService: InventoryService;
  let mockPrisma: any;
  const organizationId = 'org-123';

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    inventoryService = createInventoryService(organizationId, mockPrisma);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createInventoryItem', () => {
    it('should create a new inventory item with organization filtering', async () => {
      const newItemData = {
        productId: 1,
        expiryDate: '2025-12-31',
        locationId: 1,
        status: 'Normal' as 'Normal' | 'Markdown 1' | 'Markdown 2' | 'Markdown 3' | 'Expired',
      };

      const mockCreatedItem = {
        id: 1,
        ...newItemData,
        organizationId,
        expiryDate: new Date(newItemData.expiryDate),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock product and location validation
      mockPrisma.product.findFirst.mockResolvedValue({ id: 1, organizationId });
      mockPrisma.storeArea.findFirst.mockResolvedValue({ id: 1, organizationId });
      mockPrisma.inventoryItem.findFirst.mockResolvedValue(null); // No existing item
      mockPrisma.inventoryItem.create.mockResolvedValue(mockCreatedItem);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 1, organizationId });
      mockPrisma.organizationUsage.update.mockResolvedValue({});

      const createdItem = await inventoryService.createInventoryItem(newItemData as any, 1);

      expect(createdItem.id).toBe(1);
      expect(createdItem.status).toBe('Normal');
      expect(mockPrisma.product.findFirst).toHaveBeenCalledWith({
        where: {
          id: 1,
          organizationId,
        },
      });
      expect(mockPrisma.storeArea.findFirst).toHaveBeenCalledWith({
        where: {
          id: 1,
          organizationId,
        },
      });
      expect(mockPrisma.inventoryItem.create).toHaveBeenCalledWith({
        data: {
          organizationId,
          productId: 1,
          expiryDate: new Date('2025-12-31'),
          locationId: 1,
          status: 'Normal',
        },
      });
      expect(mockPrisma.organizationUsage.update).toHaveBeenCalledWith({
        where: { organizationId },
        data: { totalInventoryItems: { increment: 1 } },
      });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          organizationId,
          userId: 1,
          inventoryItemId: 1,
          action: 'inventory_changed',
          changeDescription: expect.any(String),
        },
      });
    });

    it('should throw error if product does not belong to organization', async () => {
      const newItemData = {
        productId: 1,
        expiryDate: '2025-12-31',
        locationId: 1,
        status: 'Normal' as 'Normal' | 'Markdown 1' | 'Markdown 2' | 'Markdown 3' | 'Expired',
      } as any;

      mockPrisma.inventoryItem.findFirst
        .mockResolvedValueOnce(null) // No existing item
        .mockResolvedValueOnce(null); // Product not found in org

      await expect(inventoryService.createInventoryItem(newItemData, 1)).rejects.toThrow(
        'Product not found or does not belong to this organization',
      );
    });

    it('should throw error if location does not belong to organization', async () => {
      const newItemData = {
        productId: 1,
        expiryDate: '2025-12-31',
        locationId: 1,
        status: 'Normal' as 'Normal' | 'Markdown 1' | 'Markdown 2' | 'Markdown 3' | 'Expired',
      } as any;

      mockPrisma.inventoryItem.findFirst.mockResolvedValue(null); // No existing item
      mockPrisma.product.findFirst.mockResolvedValue({ id: 1, organizationId }); // Product exists in org
      mockPrisma.storeArea.findFirst.mockResolvedValue(null); // Location not found in org

      await expect(inventoryService.createInventoryItem(newItemData, 1)).rejects.toThrow(
        'Location not found or does not belong to this organization',
      );
    });
  });

  describe('updateInventoryItem', () => {
    it('should update an inventory item status with organization filtering', async () => {
      const mockItem = {
        id: 1,
        productId: 1,
        locationId: 1,
        expiryDate: new Date(),
        status: 'Normal',
        createdAt: new Date(),
        updatedAt: new Date(),
        product: { organizationId },
      };

      mockPrisma.inventoryItem.findFirst.mockResolvedValue(mockItem);
      mockPrisma.inventoryItem.update.mockResolvedValue({
        ...mockItem,
        status: 'Markdown 1',
      });
      mockPrisma.user.findFirst.mockResolvedValue({ id: 1, organizationId });

      const updatedItem = await inventoryService.updateInventoryItem(
        1,
        { status: 'Markdown 1' } as any,
        1,
      );

      expect(updatedItem).not.toBeNull();
      expect(updatedItem?.status).toBe('Markdown 1');
      expect(mockPrisma.inventoryItem.findFirst).toHaveBeenCalledWith({
        where: {
          id: 1,
          organizationId,
        },
      });
      expect(mockPrisma.inventoryItem.update).toHaveBeenCalledWith({
        where: { id: 1, organizationId },
        data: { status: 'Markdown 1' },
      });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          organizationId,
          userId: 1,
          inventoryItemId: 1,
          action: 'inventory_changed',
          changeDescription: expect.any(String),
        },
      });
    });

    it('should return null if inventory item does not exist or does not belong to organization', async () => {
      mockPrisma.inventoryItem.findFirst.mockResolvedValue(null);

      const updatedItem = await inventoryService.updateInventoryItem(999, { status: 'Expired' }, 1);

      expect(updatedItem).toBeNull();
      expect(mockPrisma.inventoryItem.findFirst).toHaveBeenCalledWith({
        where: {
          id: 999,
          organizationId,
        },
      });
    });
  });

  describe('getAllInventoryItems', () => {
    it('delegates inventory reads to the repository when injected', async () => {
      const inventoryRepo = {
        findAll: vi.fn().mockResolvedValue([
          {
            id: 1,
            productId: 1,
            locationId: 1,
            organizationId,
            expiryDate: new Date('2026-01-01T00:00:00.000Z'),
            status: 'Normal',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          },
        ]),
      };
      const service = createRepositoryDelegationService(organizationId, mockPrisma, inventoryRepo);

      mockPrisma.inventoryItem.findMany.mockRejectedValue(
        new Error('service should use repository'),
      );

      const result = await service.getAllInventoryItems();

      expect(inventoryRepo.findAll).toHaveBeenCalledWith(organizationId);
      expect(mockPrisma.inventoryItem.findMany).not.toHaveBeenCalled();
      expect(result[0]).toMatchObject({
        id: 1,
        organizationId,
        status: 'Normal',
      });
    });

    it('should return all inventory items for the organization', async () => {
      const mockItems = [
        {
          id: 1,
          productId: 1,
          locationId: 1,
          organizationId,
          expiryDate: new Date(),
          status: 'Normal',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.inventoryItem.findMany.mockResolvedValue(mockItems);

      const items = await inventoryService.getAllInventoryItems();

      expect(items).toHaveLength(1);
      expect(mockPrisma.inventoryItem.findMany).toHaveBeenCalledWith({
        where: {
          organizationId,
        },
      });
    });
  });

  describe('getInventoryItemById', () => {
    it('delegates item lookup to the repository when injected', async () => {
      const inventoryRepo = {
        findById: vi.fn().mockResolvedValue({
          id: 1,
          productId: 1,
          locationId: 1,
          organizationId,
          expiryDate: new Date('2026-01-01T00:00:00.000Z'),
          status: 'Normal',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        }),
      };
      const service = createRepositoryDelegationService(organizationId, mockPrisma, inventoryRepo);

      mockPrisma.inventoryItem.findFirst.mockRejectedValue(
        new Error('service should use repository'),
      );

      const result = await service.getInventoryItemById(1);

      expect(inventoryRepo.findById).toHaveBeenCalledWith(1, organizationId);
      expect(mockPrisma.inventoryItem.findFirst).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        id: 1,
        organizationId,
        status: 'Normal',
      });
    });
  });

  describe('getInventoryItemsByProductId', () => {
    it('delegates product inventory reads to the repository when injected', async () => {
      const inventoryRepo = {
        findByProductId: vi.fn().mockResolvedValue([]),
      };
      const service = createRepositoryDelegationService(organizationId, mockPrisma, inventoryRepo);

      mockPrisma.inventoryItem.findMany.mockRejectedValue(
        new Error('service should use repository'),
      );

      await service.getInventoryItemsByProductId(1);

      expect(inventoryRepo.findByProductId).toHaveBeenCalledWith(1, organizationId);
      expect(mockPrisma.inventoryItem.findMany).not.toHaveBeenCalled();
    });

    it('should return inventory items for a specific product within organization', async () => {
      const mockItems = [
        {
          id: 1,
          productId: 1,
          locationId: 1,
          organizationId,
          expiryDate: new Date(),
          status: 'Normal',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.inventoryItem.findMany.mockResolvedValue(mockItems);

      const items = await inventoryService.getInventoryItemsByProductId(1);

      expect(items).toHaveLength(1);
      expect(mockPrisma.inventoryItem.findMany).toHaveBeenCalledWith({
        where: {
          productId: 1,
          organizationId,
        },
      });
    });
  });

  describe('getRecentInventoryItemsByProductId', () => {
    it('delegates recent product inventory reads to the repository when injected', async () => {
      const inventoryRepo = {
        findRecentByProductId: vi.fn().mockResolvedValue([]),
      };
      const service = createRepositoryDelegationService(organizationId, mockPrisma, inventoryRepo);

      mockPrisma.inventoryItem.findMany.mockRejectedValue(
        new Error('service should use repository'),
      );

      await service.getRecentInventoryItemsByProductId(1, 5);

      expect(inventoryRepo.findRecentByProductId).toHaveBeenCalledWith(1, organizationId, 5);
      expect(mockPrisma.inventoryItem.findMany).not.toHaveBeenCalled();
    });

    it('should return recent inventory items for a specific product within organization', async () => {
      const mockItems = [
        {
          id: 1,
          productId: 1,
          locationId: 1,
          organizationId,
          expiryDate: new Date(),
          status: 'Normal',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.inventoryItem.findMany.mockResolvedValue(mockItems);

      const items = await inventoryService.getRecentInventoryItemsByProductId(1, 5);

      expect(items).toHaveLength(1);
      expect(mockPrisma.inventoryItem.findMany).toHaveBeenCalledWith({
        where: {
          productId: 1,
          organizationId,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
    });
  });

  describe('getInventoryItemsByLocationId', () => {
    it('delegates location inventory reads to the repository when injected', async () => {
      const inventoryRepo = {
        findByLocationId: vi.fn().mockResolvedValue([]),
      };
      const service = createRepositoryDelegationService(organizationId, mockPrisma, inventoryRepo);

      mockPrisma.inventoryItem.findMany.mockRejectedValue(
        new Error('service should use repository'),
      );

      await service.getInventoryItemsByLocationId(1);

      expect(inventoryRepo.findByLocationId).toHaveBeenCalledWith(1, organizationId);
      expect(mockPrisma.inventoryItem.findMany).not.toHaveBeenCalled();
    });

    it('should return inventory items for a specific location within organization', async () => {
      const mockItems = [
        {
          id: 1,
          productId: 1,
          locationId: 1,
          organizationId,
          expiryDate: new Date(),
          status: 'Normal',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.inventoryItem.findMany.mockResolvedValue(mockItems);

      const items = await inventoryService.getInventoryItemsByLocationId(1);

      expect(items).toHaveLength(1);
      expect(mockPrisma.inventoryItem.findMany).toHaveBeenCalledWith({
        where: {
          locationId: 1,
          organizationId,
        },
      });
    });
  });

  describe('deleteInventoryItem', () => {
    it('should delete inventory item and create audit log if item belongs to organization', async () => {
      const mockItem = {
        id: 1,
        productId: 1,
        locationId: 1,
        expiryDate: new Date(),
        status: 'Normal',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.inventoryItem.findFirst.mockResolvedValue(mockItem);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 1, organizationId });
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.inventoryItem.delete.mockResolvedValue(mockItem);
      mockPrisma.organizationUsage.findUnique.mockResolvedValue({
        organizationId,
        totalInventoryItems: 10,
      });
      mockPrisma.organizationUsage.update.mockResolvedValue({});

      const result = await inventoryService.deleteInventoryItem(1, 1);

      expect(result).toBe(true);
      expect(mockPrisma.inventoryItem.findFirst).toHaveBeenCalledWith({
        where: {
          id: 1,
          organizationId,
        },
      });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          organizationId,
          userId: 1,
          inventoryItemId: 1,
          action: 'inventory_changed',
          changeDescription: 'Inventory item with ID 1 deleted.',
        },
      });
      expect(mockPrisma.inventoryItem.delete).toHaveBeenCalledWith({
        where: { id: 1, organizationId },
      });
      expect(mockPrisma.organizationUsage.update).toHaveBeenCalledWith({
        where: { organizationId },
        data: { totalInventoryItems: { decrement: 1 } },
      });
    });

    it('should return false if inventory item does not exist or does not belong to organization', async () => {
      mockPrisma.inventoryItem.findFirst.mockResolvedValue(null);

      const result = await inventoryService.deleteInventoryItem(999, 1);

      expect(result).toBe(false);
    });
  });

  describe('autoCalculateMarkdownStatus', () => {
    it('should update markdown status for inventory item within organization', async () => {
      const mockItem = {
        id: 1,
        productId: 1,
        locationId: 1,
        expiryDate: new Date(),
        status: 'Normal',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.inventoryItem.findFirst.mockResolvedValue(mockItem);
      mockPrisma.inventoryItem.update.mockResolvedValue({ ...mockItem, status: 'Expired' });

      await inventoryService.autoCalculateMarkdownStatus(1, '2020-01-01');

      expect(mockPrisma.inventoryItem.findFirst).toHaveBeenCalledWith({
        where: {
          id: 1,
          organizationId,
        },
      });
      expect(mockPrisma.inventoryItem.update).toHaveBeenCalledWith({
        where: { id: 1, organizationId },
        data: { status: 'Expired' },
      });
    });

    it('should throw error if inventory item does not belong to organization', async () => {
      mockPrisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(inventoryService.autoCalculateMarkdownStatus(1, '2025-12-31')).rejects.toThrow(
        'Inventory item not found or does not belong to this organization',
      );
    });
  });

  describe('logTransaction', () => {
    it('should log transaction for inventory item within organization', async () => {
      const mockItem = {
        id: 1,
        productId: 1,
        locationId: 1,
        expiryDate: new Date(),
        status: 'Normal',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.inventoryItem.findFirst.mockResolvedValue(mockItem);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 1, organizationId });
      mockPrisma.itemTransaction.create.mockResolvedValue({ id: 1 });

      const transactionId = await inventoryService.logTransaction({
        inventory_item_id: 1,
        user_id: 1,
        type: 'in',
        quantity_change: 10,
        notes: 'Test transaction',
      } as any);

      expect(transactionId).toBe(1);
      expect(mockPrisma.inventoryItem.findFirst).toHaveBeenCalledWith({
        where: {
          id: 1,
          organizationId,
        },
      });
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: 1,
          organizationId,
        },
      });
      expect(mockPrisma.itemTransaction.create).toHaveBeenCalledWith({
        data: {
          organizationId,
          inventoryItemId: 1,
          userId: 1,
          type: 'in',
          quantityChange: 10,
          notes: 'Test transaction',
        },
      });
    });

    it('should throw error if inventory item does not belong to organization', async () => {
      mockPrisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(
        inventoryService.logTransaction({
          inventory_item_id: 1,
          user_id: 1,
          type: 'in',
          quantity_change: 10,
          notes: 'Test transaction',
        } as any),
      ).rejects.toThrow('Inventory item not found or does not belong to this organization');
    });

    it('should throw error if user does not belong to organization', async () => {
      const mockItem = {
        id: 1,
        productId: 1,
        locationId: 1,
        expiryDate: new Date(),
        status: 'Normal',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.inventoryItem.findFirst.mockResolvedValue(mockItem);
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        inventoryService.logTransaction({
          inventory_item_id: 1,
          user_id: 1,
          type: 'in',
          quantity_change: 10,
          notes: 'Test transaction',
        } as any),
      ).rejects.toThrow('User not found or does not belong to this organization');
    });
  });

  describe('calculateMarkdownStatusSync', () => {
    it('should return "Expired" for dates in the past', () => {
      const date = new Date();
      date.setDate(date.getDate() - 1);
      const expiryDate = date.toISOString().split('T')[0];
      expect(inventoryService.calculateMarkdownStatusSync(expiryDate)).toBe('Expired');
    });

    it('should return "Markdown 3" for dates within the next 30 days', () => {
      const date = new Date();
      date.setDate(date.getDate() + 30);
      const expiryDate = date.toISOString().split('T')[0];
      expect(inventoryService.calculateMarkdownStatusSync(expiryDate)).toBe('Markdown 3');
    });

    it("should return 'Markdown 2' for dates between 31 and 60 days from now", () => {
      const date = new Date();
      date.setDate(date.getDate() + 60);
      const expiryDate = date.toISOString().split('T')[0];
      expect(inventoryService.calculateMarkdownStatusSync(expiryDate)).toBe('Markdown 2');
    });

    it("should return 'Markdown 1' for dates between 61 and 90 days from now", () => {
      const date = new Date();
      date.setDate(date.getDate() + 90);
      const expiryDate = date.toISOString().split('T')[0];
      expect(inventoryService.calculateMarkdownStatusSync(expiryDate)).toBe('Markdown 1');
    });

    it('should return "Normal" for dates more than 90 days from now', () => {
      const date = new Date();
      date.setDate(date.getDate() + 91);
      const expiryDate = date.toISOString().split('T')[0];
      expect(inventoryService.calculateMarkdownStatusSync(expiryDate)).toBe('Normal');
    });
  });
});
