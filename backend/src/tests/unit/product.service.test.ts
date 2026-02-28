import { ProductService } from '../../services/product.service';
import { PrismaClient } from '@prisma/client';

describe('ProductService with organizationId', () => {
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
        findUnique: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(mockPrisma)),
    };
    productService = new ProductService(mockPrisma as unknown as PrismaClient, organizationId);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllProducts', () => {
    it('should return all products for the organization', async () => {
      const mockProducts = [
        {
          id: 1,
          organizationId,
          barcode: '123456789',
          sku: 'TEST-001',
          name: 'Test Product',
          costPrice: 10.99,
          notes: '',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.product.findMany.mockResolvedValue(mockProducts);

      const products = await productService.getAllProducts();

      expect(products).toHaveLength(1);
      expect(products[0].organizationId).toBe(organizationId);
      expect(mockPrisma.product.findMany).toHaveBeenCalledWith({
        where: {
          organizationId,
        },
      });
    });

    it('should apply limit and offset when provided', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);

      await productService.getAllProducts(10, 20);

      expect(mockPrisma.product.findMany).toHaveBeenCalledWith({
        where: {
          organizationId,
        },
        take: 10,
        skip: 20,
      });
    });
  });

  describe('getProductById', () => {
    it('should return product if it belongs to the organization', async () => {
      const mockProduct = {
        id: 1,
        organizationId,
        barcode: '123456789',
        sku: 'TEST-001',
        name: 'Test Product',
        costPrice: 10.99,
        notes: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.product.findUnique.mockResolvedValue(mockProduct);

      const product = await productService.getProductById(1);

      expect(product).not.toBeNull();
      expect(product?.id).toBe(1);
      expect(product?.organizationId).toBe(organizationId);
      expect(mockPrisma.product.findUnique).toHaveBeenCalledWith({
        where: {
          id: 1,
          organizationId,
        },
      });
    });

    it('should return null if product does not exist or belongs to different organization', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);

      const product = await productService.getProductById(999);

      expect(product).toBeNull();
      expect(mockPrisma.product.findUnique).toHaveBeenCalledWith({
        where: {
          id: 999,
          organizationId,
        },
      });
    });
  });

  describe('getProductByBarcode', () => {
    it('should return product if barcode matches within organization', async () => {
      const mockProduct = {
        id: 1,
        organizationId,
        barcode: '123456789',
        sku: 'TEST-001',
        name: 'Test Product',
        costPrice: 10.99,
        notes: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.product.findUnique.mockResolvedValue(mockProduct);

      const product = await productService.getProductByBarcode('123456789');

      expect(product).not.toBeNull();
      expect(product?.barcode).toBe('123456789');
      expect(mockPrisma.product.findUnique).toHaveBeenCalledWith({
        where: {
          organizationId_barcode: {
            organizationId,
            barcode: '123456789',
          },
        },
      });
    });
  });

  describe('getProductBySku', () => {
    it('should return product if SKU matches within organization', async () => {
      const mockProduct = {
        id: 1,
        organizationId,
        barcode: '123456789',
        sku: 'TEST-001',
        name: 'Test Product',
        costPrice: 10.99,
        notes: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.product.findUnique.mockResolvedValue(mockProduct);

      const product = await productService.getProductBySku('TEST-001');

      expect(product).not.toBeNull();
      expect(product?.sku).toBe('TEST-001');
      expect(mockPrisma.product.findUnique).toHaveBeenCalledWith({
        where: {
          organizationId_sku: {
            organizationId,
            sku: 'TEST-001',
          },
        },
      });
    });
  });

  describe('createProduct', () => {
    it('should create a product with organizationId and increment SKU counter', async () => {
      const productData = {
        barcode: '123456789',
        sku: 'TEST-001',
        name: 'Test Product',
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

      const mockUsage = {
        organizationId,
        totalSkus: 0,
        maxSkus: 1000,
      };

      mockPrisma.organizationUsage.findUnique.mockResolvedValue(mockUsage);
      mockPrisma.product.create.mockResolvedValue(mockCreatedProduct);
      mockPrisma.organizationUsage.update.mockResolvedValue({
        ...mockUsage,
        totalSkus: 1,
      });

      const result = await productService.createProduct(productData);

      expect(result.id).toBe(1);
      expect(result.organizationId).toBe(organizationId);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.product.create).toHaveBeenCalledWith({
        data: {
          ...productData,
          organizationId,
        },
      });
      expect(mockPrisma.organizationUsage.update).toHaveBeenCalledWith({
        where: { organizationId },
        data: { totalSkus: { increment: 1 } },
      });
    });

    it('should throw error if SKU limit is reached', async () => {
      const productData = {
        barcode: '123456789',
        sku: 'TEST-001',
        name: 'Test Product',
        costPrice: 10.99,
      };

      const mockUsage = {
        organizationId,
        totalSkus: 1000,
        maxSkus: 1000,
      };

      mockPrisma.organizationUsage.findUnique.mockResolvedValue(mockUsage);

      await expect(productService.createProduct(productData)).rejects.toThrow(
        'SKU limit reached for this organization (1000 max)',
      );

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.product.create).not.toHaveBeenCalled();
      expect(mockPrisma.organizationUsage.update).not.toHaveBeenCalled();
    });

    it('should throw error if organization usage record not found', async () => {
      const productData = {
        barcode: '123456789',
        sku: 'TEST-001',
        name: 'Test Product',
        costPrice: 10.99,
      };

      mockPrisma.organizationUsage.findUnique.mockResolvedValue(null);

      await expect(productService.createProduct(productData)).rejects.toThrow(
        'Organization usage record not found',
      );
    });
  });

  describe('updateProduct', () => {
    it('should update product if it belongs to organization', async () => {
      const updateData = {
        name: 'Updated Product',
        costPrice: 15.99,
      };

      const mockUpdatedProduct = {
        id: 1,
        organizationId,
        barcode: '123456789',
        sku: 'TEST-001',
        name: 'Updated Product',
        costPrice: 15.99,
        notes: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.product.update.mockResolvedValue(mockUpdatedProduct);

      const result = await productService.updateProduct(1, updateData);

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Updated Product');
      expect(result?.costPrice).toBe(15.99);
      expect(mockPrisma.product.update).toHaveBeenCalledWith({
        where: {
          id: 1,
          organizationId,
        },
        data: {
          name: 'Updated Product',
          costPrice: 15.99,
        },
      });
    });

    it('should return null if product does not exist or belongs to different organization', async () => {
      const error = new Error('Record not found');
      (error as any).code = 'P2025';
      mockPrisma.product.update.mockRejectedValue(error);

      const result = await productService.updateProduct(999, { name: 'Updated' });

      expect(result).toBeNull();
    });

    it('should return null if no update data provided', async () => {
      const result = await productService.updateProduct(1, {});

      expect(result).toBeNull();
      expect(mockPrisma.product.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteProduct', () => {
    it('should delete product and decrement SKU counter if it belongs to organization', async () => {
      const mockUsage = {
        organizationId,
        totalSkus: 10,
        maxSkus: 1000,
      };

      mockPrisma.organizationUsage.findUnique.mockResolvedValue(mockUsage);
      mockPrisma.product.delete.mockResolvedValue({ id: 1 });
      mockPrisma.organizationUsage.update.mockResolvedValue({
        ...mockUsage,
        totalSkus: 9,
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

    it('should return false if product does not exist or belongs to different organization', async () => {
      const error = new Error('Record not found');
      (error as any).code = 'P2025';
      mockPrisma.product.delete.mockRejectedValue(error);

      const result = await productService.deleteProduct(999);

      expect(result).toBe(false);
    });

    it('should throw error for other database errors', async () => {
      const error = new Error('Database connection failed');
      mockPrisma.product.delete.mockRejectedValue(error);

      await expect(productService.deleteProduct(1)).rejects.toThrow('Database connection failed');
    });
  });

  describe('Constructor with dependency injection', () => {
    it('should use provided organizationId when given', () => {
      const customOrgId = 'custom-org-456';
      const customService = new ProductService(mockPrisma, customOrgId);

      // Test that the service uses the custom organizationId
      mockPrisma.product.findMany.mockResolvedValue([]);
      customService.getAllProducts();

      expect(mockPrisma.product.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: customOrgId,
        },
      });
    });

    it('should use default organizationId when none provided', () => {
      // This tests the getOrganizationId fallback behavior
      const defaultService = new ProductService(mockPrisma);

      mockPrisma.product.findMany.mockResolvedValue([]);
      defaultService.getAllProducts();

      expect(mockPrisma.product.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'default-org', // From getOrganizationId default
        },
      });
    });
  });
});
