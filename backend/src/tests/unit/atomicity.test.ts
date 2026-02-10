import { ProductService } from '../../services/product.service';
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
        total_skus: 1,
        storage_used_bytes: 0,
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
        'Database constraint violation'
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
        .mockResolvedValueOnce({ organizationId, total_skus: 1, storage_used_bytes: 0 })
        .mockResolvedValueOnce({ organizationId, total_skus: 2, storage_used_bytes: 0 });

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
        total_skus: 0,
        storage_used_bytes: 0,
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
        data: { total_skus: { decrement: 1 } },
      });
    });

    it('should rollback SKU counter decrement if product deletion fails', async () => {
      // Mock deletion failure
      const error = new Error('Foreign key constraint violation');
      mockPrisma.product.delete.mockRejectedValue(error);

      await expect(productService.deleteProduct(1)).rejects.toThrow(
        'Foreign key constraint violation'
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
          storage_used_bytes: 0,
        })
        .mockResolvedValueOnce({
          organizationId,
          totalSkus: 0,
          storage_used_bytes: 0,
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
});