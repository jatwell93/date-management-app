import { ProductService } from '../../services/product.service';
import { InventoryService } from '../../services/inventory.service';
import { PrismaClient } from '@prisma/client';

describe('Usage Counter Atomicity Tests', () => {
  let productService: ProductService;
  let mockPrisma: any;
  const organizationId = 'org-123';

  beforeEach(() => {
    mockPrisma = {
      product: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        delete: jest.fn(),
      },
      organizationUsage: {
        upsert: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({
          organizationId,
          totalSkus: 0,
          maxSkus: 1000,
          totalInventoryItems: 10,
        }),
      },
      inventoryItem: {
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      storeArea: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      user: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(mockPrisma)),
    };
    productService = new ProductService(mockPrisma as unknown as PrismaClient, organizationId);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createProduct - Atomic SKU Counter Increment', () => {
    it('should atomically increment total_skus when product is created successfully', async () => {
      const productData = {
        name: 'Test Product',
        sku: 'TEST-001',
        barcode: '123456789',
        costPrice: 10.99,
      };

      const mockCreatedProduct = {
        id: 1,
        ...productData,
        organizationId,
        notes: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock successful product creation
      mockPrisma.product.create.mockResolvedValue(mockCreatedProduct);
      // Mock organization usage update
      mockPrisma.organizationUsage.update.mockResolvedValue({
        organizationId,
        totalSkus: 1,
        storageUsedBytes: 0,
      });

      const result = await productService.createProduct(productData);

      expect(result.id).toBe(1);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.product.create).toHaveBeenCalledWith({
        data: {
          barcode: productData.barcode,
          sku: productData.sku,
          name: productData.name,
          costPrice: productData.costPrice,
          organizationId,
        },
      });
      expect(mockPrisma.organizationUsage.update).toHaveBeenCalledWith({
        where: { organizationId },
        data: { totalSkus: { increment: 1 } },
      });
    });

    it('should rollback SKU counter if product creation fails', async () => {
      const productData = {
        name: 'Test Product',
        sku: 'TEST-001',
        barcode: '123456789',
        costPrice: 10.99,
      };

      // Mock product creation failure
      const error = new Error('Database constraint violation');
      mockPrisma.product.create.mockRejectedValue(error);

      await expect(productService.createProduct(productData)).rejects.toThrow(
        'Database constraint violation',
      );

      // Verify transaction was attempted but rolled back
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      // organizationUsage.update should not be called due to transaction rollback
      expect(mockPrisma.organizationUsage.update).not.toHaveBeenCalled();
    });

    it('should handle concurrent SKU counter updates correctly', async () => {
      const productData1 = {
        name: 'Product 1',
        sku: 'TEST-001',
        barcode: '123456789',
        costPrice: 10.99,
      };

      const productData2 = {
        name: 'Product 2',
        sku: 'TEST-002',
        barcode: '987654321',
        costPrice: 20.99,
      };

      const mockProduct1 = {
        id: 1,
        ...productData1,
        organizationId,
        notes: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockProduct2 = {
        id: 2,
        ...productData2,
        organizationId,
        notes: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock concurrent operations
      mockPrisma.product.create
        .mockResolvedValueOnce(mockProduct1)
        .mockResolvedValueOnce(mockProduct2);

      mockPrisma.organizationUsage.update
        .mockResolvedValueOnce({ organizationId, totalSkus: 1, storageUsedBytes: 0 })
        .mockResolvedValueOnce({ organizationId, totalSkus: 2, storageUsedBytes: 0 });

      // Create both products concurrently
      const [result1, result2] = await Promise.all([
        productService.createProduct(productData1),
        productService.createProduct(productData2),
      ]);

      expect(result1.id).toBe(1);
      expect(result2.id).toBe(2);
      expect(mockPrisma.organizationUsage.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('deleteProduct - Atomic SKU Counter Decrement', () => {
    it('should atomically decrement total_skus when product is deleted successfully', async () => {
      const mockProduct = {
        id: 1,
        name: 'Test Product',
        sku: 'TEST-001',
        barcode: '123456789',
        costPrice: 10.99,
        notes: '',
        organizationId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock successful deletion
      mockPrisma.product.delete.mockResolvedValue(mockProduct);
      // Mock usage decrement
      mockPrisma.organizationUsage.update.mockResolvedValue({
        organizationId,
        totalSkus: 0,
        storageUsedBytes: 0,
      });

      const result = await productService.deleteProduct(1);

      expect(result).toBe(true);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.product.delete).toHaveBeenCalledWith({
        where: {
          id: 1,
          organizationId,
        },
      });
      expect(mockPrisma.organizationUsage.update).toHaveBeenCalledWith({
        where: { organizationId },
        data: { totalSkus: { decrement: 1 } },
      });
    });

    it('should rollback SKU counter decrement if product deletion fails', async () => {
      // Mock deletion failure
      const error = new Error('Foreign key constraint violation');
      mockPrisma.product.delete.mockRejectedValue(error);

      await expect(productService.deleteProduct(1)).rejects.toThrow(
        'Foreign key constraint violation',
      );

      // Verify transaction was attempted but rolled back
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      // organizationUsage.update should not be called due to transaction rollback
      expect(mockPrisma.organizationUsage.update).not.toHaveBeenCalled();
    });

    it('should return false if product does not exist or does not belong to organization', async () => {
      // Mock product not found (Prisma throws P2025 error)
      const prismaError = { code: 'P2025', message: 'Record not found' };
      mockPrisma.product.delete.mockRejectedValue(prismaError);

      const result = await productService.deleteProduct(999);

      expect(result).toBe(false);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      // organizationUsage.update should not be called due to transaction rollback
      expect(mockPrisma.organizationUsage.update).not.toHaveBeenCalled();
    });
  });

  describe('Race Condition Prevention', () => {
    it('should prevent SKU counter corruption during concurrent create/delete operations', async () => {
      const createData = {
        name: 'Concurrent Product',
        sku: 'CONCURRENT-001',
        barcode: '111111111',
        costPrice: 5.99,
      };

      const mockCreatedProduct = {
        id: 1,
        ...createData,
        organizationId,
        notes: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockExistingProduct = {
        id: 1,
        ...createData,
        organizationId,
        notes: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Setup mocks for concurrent operations
      mockPrisma.product.create.mockResolvedValue(mockCreatedProduct);
      mockPrisma.product.delete.mockResolvedValue(mockExistingProduct);

      mockPrisma.organizationUsage.update
        .mockResolvedValueOnce({
          organizationId,
          totalSkus: 1,
          storageUsedBytes: 0,
        })
        .mockResolvedValueOnce({
          organizationId,
          totalSkus: 0,
          storageUsedBytes: 0,
        });

      // Simulate create and immediate delete (race condition scenario)
      await productService.createProduct(createData);
      await productService.deleteProduct(1);

      // Verify both operations used transactions
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
      // Verify counter was incremented then decremented
      expect(mockPrisma.organizationUsage.update).toHaveBeenCalledWith({
        where: { organizationId },
        data: { totalSkus: { increment: 1 } },
      });
      expect(mockPrisma.organizationUsage.update).toHaveBeenCalledWith({
        where: { organizationId },
        data: { totalSkus: { decrement: 1 } },
      });
    });
  });

  describe('Inventory Service - Atomic Inventory Item Counter', () => {
    let inventoryService: InventoryService;
    let mockPrisma: any;
    const organizationId = 'org-123';

    beforeEach(() => {
      mockPrisma = {
        inventoryItem: {
          create: jest.fn(),
          update: jest.fn(),
          findUnique: jest.fn(),
          findMany: jest.fn(),
          findFirst: jest.fn(),
          delete: jest.fn(),
        },
        product: {
          findFirst: jest.fn(),
          findUnique: jest.fn(),
        },
        storeArea: {
          findFirst: jest.fn(),
        },
        user: {
          findFirst: jest.fn(),
        },
        auditLog: {
          create: jest.fn(),
        },
        organizationUsage: {
          findUnique: jest.fn().mockResolvedValue({
            organizationId,
            totalInventoryItems: 10,
            maxInventoryItems: 10000,
          }),
          update: jest.fn(),
        },
        $transaction: jest.fn((callback) => callback(mockPrisma)),
      };
      inventoryService = new InventoryService(
        organizationId,
        mockPrisma as unknown as PrismaClient,
      );
    });

    it('should atomically increment total_inventory_items when inventory item is created successfully', async () => {
      const itemData = {
        productId: 1,
        expiryDate: '2025-12-31',
        locationId: 1,
      };

      const mockCreatedItem = {
        id: 1,
        ...itemData,
        organizationId,
        expiryDate: new Date(itemData.expiryDate),
        status: 'Normal',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock product and location validation
      mockPrisma.product.findUnique.mockResolvedValue({ id: 1, organizationId });
      mockPrisma.storeArea.findFirst.mockResolvedValue({ id: 1, organizationId });
      mockPrisma.inventoryItem.create.mockResolvedValue(mockCreatedItem);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 1, organizationId });
      mockPrisma.organizationUsage.update.mockResolvedValue({
        organizationId,
        totalInventoryItems: 1,
      });

      // Mock the calculateMarkdownStatus method to return 'Normal' for the future date
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      jest.spyOn(inventoryService, 'calculateMarkdownStatus').mockResolvedValue('Normal');

      const result = await inventoryService.createInventoryItem(itemData, 1);

      expect(result.id).toBe(1);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
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
    });

    it('should rollback inventory item counter if item creation fails', async () => {
      const itemData = {
        productId: 1,
        expiryDate: '2025-12-31',
        locationId: 1,
      };

      // Mock product and location validation to pass
      mockPrisma.product.findUnique.mockResolvedValue({ id: 1, organizationId });
      mockPrisma.storeArea.findFirst.mockResolvedValue({ id: 1, organizationId });
      // Mock item creation failure
      const error = new Error('Database constraint violation');
      mockPrisma.inventoryItem.create.mockRejectedValue(error);

      await expect(inventoryService.createInventoryItem(itemData, 1)).rejects.toThrow(
        'Database constraint violation',
      );

      // Verify transaction was attempted but rolled back
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      // organizationUsage.update should not be called due to transaction rollback
      expect(mockPrisma.organizationUsage.update).not.toHaveBeenCalled();
    });

    it('should atomically decrement total_inventory_items when inventory item is deleted successfully', async () => {
      const mockItem = {
        id: 1,
        productId: 1,
        expiryDate: new Date('2025-12-31'),
        locationId: 1,
        status: 'Normal',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockUsage = {
        organizationId,
        totalInventoryItems: 10,
        maxInventoryItems: 10000,
      };

      mockPrisma.inventoryItem.findFirst.mockResolvedValue(mockItem);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 1, organizationId });
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.inventoryItem.delete.mockResolvedValue(mockItem);
      mockPrisma.organizationUsage.update.mockResolvedValue({
        ...mockUsage,
        totalInventoryItems: 9,
      });

      const result = await inventoryService.deleteInventoryItem(1, 1);

      expect(result).toBe(true);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.inventoryItem.delete).toHaveBeenCalledWith({
        where: { id: 1, organizationId: 'org-123' },
      });
      expect(mockPrisma.organizationUsage.update).toHaveBeenCalledWith({
        where: { organizationId },
        data: { totalInventoryItems: { decrement: 1 } },
      });
    });

    it('should handle concurrent inventory item counter updates correctly', async () => {
      const itemData1 = {
        productId: 1,
        expiryDate: '2025-12-31',
        locationId: 1,
      };

      const itemData2 = {
        productId: 2,
        expiryDate: '2025-12-31',
        locationId: 2,
      };

      const mockCreatedItem1 = {
        id: 1,
        ...itemData1,
        organizationId,
        expiryDate: new Date(itemData1.expiryDate),
        status: 'Normal',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockCreatedItem2 = {
        id: 2,
        ...itemData2,
        organizationId,
        expiryDate: new Date(itemData2.expiryDate),
        status: 'Normal',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock product and location validation for both items
      mockPrisma.product.findUnique
        .mockResolvedValueOnce({ id: 1, organizationId })
        .mockResolvedValueOnce({ id: 2, organizationId });
      mockPrisma.storeArea.findFirst
        .mockResolvedValueOnce({ id: 1, organizationId })
        .mockResolvedValueOnce({ id: 2, organizationId });
      mockPrisma.user.findFirst.mockResolvedValue({ id: 1, organizationId });

      // Mock concurrent operations
      mockPrisma.inventoryItem.create
        .mockResolvedValueOnce(mockCreatedItem1)
        .mockResolvedValueOnce(mockCreatedItem2);

      mockPrisma.organizationUsage.update
        .mockResolvedValueOnce({ organizationId, totalInventoryItems: 1 })
        .mockResolvedValueOnce({ organizationId, totalInventoryItems: 2 });

      // Create both items concurrently
      const [result1, result2] = await Promise.all([
        inventoryService.createInventoryItem(itemData1, 1),
        inventoryService.createInventoryItem(itemData2, 1),
      ]);

      expect(result1.id).toBe(1);
      expect(result2.id).toBe(2);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
      expect(mockPrisma.organizationUsage.update).toHaveBeenCalledTimes(2);
      expect(mockPrisma.organizationUsage.update).toHaveBeenCalledWith({
        where: { organizationId },
        data: { totalInventoryItems: { increment: 1 } },
      });
    });

    it('should handle create and delete race condition for inventory items', async () => {
      const itemData = {
        productId: 1,
        expiryDate: '2025-12-31',
        locationId: 1,
      };

      const mockCreatedItem = {
        id: 1,
        ...itemData,
        organizationId,
        expiryDate: new Date(itemData.expiryDate),
        status: 'Normal',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockExistingItem = {
        id: 1,
        ...itemData,
        organizationId,
        expiryDate: new Date(itemData.expiryDate),
        status: 'Normal',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockUsage = {
        organizationId,
        totalInventoryItems: 10,
        maxInventoryItems: 10000,
      };

      // Setup mocks for concurrent operations
      mockPrisma.product.findUnique.mockResolvedValue({ id: 1, organizationId });
      mockPrisma.storeArea.findFirst.mockResolvedValue({ id: 1, organizationId });
      mockPrisma.user.findFirst.mockResolvedValue({ id: 1, organizationId });
      mockPrisma.inventoryItem.create.mockResolvedValue(mockCreatedItem);
      mockPrisma.inventoryItem.findFirst.mockResolvedValue(mockExistingItem);
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.inventoryItem.delete.mockResolvedValue(mockExistingItem);
      mockPrisma.organizationUsage.findUnique.mockResolvedValue({
        organizationId,
        totalInventoryItems: 10,
      });

      mockPrisma.organizationUsage.update
        .mockResolvedValueOnce({
          organizationId,
          totalInventoryItems: 11,
        })
        .mockResolvedValueOnce({
          organizationId,
          totalInventoryItems: 10,
        });

      // Simulate create and immediate delete (race condition scenario)
      await inventoryService.createInventoryItem(itemData, 1);
      await inventoryService.deleteInventoryItem(1, 1);

      // Verify both operations used transactions
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
      // Verify counter was incremented then decremented
      expect(mockPrisma.organizationUsage.update).toHaveBeenCalledWith({
        where: { organizationId },
        data: { totalInventoryItems: { increment: 1 } },
      });
      expect(mockPrisma.organizationUsage.update).toHaveBeenCalledWith({
        where: { organizationId },
        data: { totalInventoryItems: { decrement: 1 } },
      });
    });

    it('should not decrement counter when totalInventoryItems is already 0', async () => {
      const mockItem = {
        id: 1,
        productId: 1,
        expiryDate: new Date('2025-12-31'),
        locationId: 1,
        status: 'Normal',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock item exists but usage counter is 0
      mockPrisma.inventoryItem.findFirst.mockResolvedValue(mockItem);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 1, organizationId });
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.inventoryItem.delete.mockResolvedValue(mockItem);
      mockPrisma.organizationUsage.findUnique.mockResolvedValue({
        organizationId,
        totalInventoryItems: 0,
      });

      const result = await inventoryService.deleteInventoryItem(1, 1);

      expect(result).toBe(true);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.inventoryItem.delete).toHaveBeenCalledWith({
        where: { id: 1, organizationId: 'org-123' },
      });
      // organizationUsage.update should NOT be called when counter is 0
      expect(mockPrisma.organizationUsage.update).not.toHaveBeenCalledWith({
        where: { organizationId },
        data: { totalInventoryItems: { decrement: 1 } },
      });
    });

    it('should throw error when exceeding maxInventoryItems limit', async () => {
      const itemData = {
        productId: 1,
        expiryDate: '2025-12-31',
        locationId: 1,
      };

      // Mock product and location validation
      mockPrisma.product.findUnique.mockResolvedValue({ id: 1, organizationId });
      mockPrisma.storeArea.findFirst.mockResolvedValue({ id: 1, organizationId });

      // Mock usage limit reached
      mockPrisma.organizationUsage.findUnique.mockResolvedValue({
        organizationId,
        totalInventoryItems: 100,
        maxInventoryItems: 100,
      });

      await expect(inventoryService.createInventoryItem(itemData, 1)).rejects.toThrow(
        'Cannot create inventory item: maximum limit of 100 inventory items reached. Current usage: 100.',
      );

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      // inventoryItem.create should NOT be called when limit is reached
      expect(mockPrisma.inventoryItem.create).not.toHaveBeenCalled();
    });
  });
});
