import { ProductService } from '../../services/product.service';
import { Product } from '../../models/product.model';
import { PrismaClient } from '@prisma/client';

describe('ProductService', () => {
  let productService: ProductService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      product: {
        findUnique: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    productService = new ProductService(mockPrisma as unknown as PrismaClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return a product by barcode', async () => {
    const mockProduct = {
      id: 1,
      barcode: '123',
      sku: 'SKU1',
      name: 'Product 1',
      costPrice: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    mockPrisma.product.findUnique.mockResolvedValue(mockProduct);

    const product = await productService.getProductByBarcode('123');

    // Compare fields ignoring dates (since we map them)
    expect(product).toBeDefined();
    expect(product?.barcode).toBe(mockProduct.barcode);
    expect(mockPrisma.product.findUnique).toHaveBeenCalledWith({
      where: { barcode: '123' }
    });
  });

  it('should return null if product not found by barcode', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(null);

    const product = await productService.getProductByBarcode('non_existent');
    expect(product).toBeNull();
  });

  it('should create a new product', async () => {
    const newProductData = {
      barcode: '456',
      sku: 'SKU2',
      name: 'Product 2',
      costPrice: 20,
    };
    
    // Mock return from create
    const mockCreatedProduct = {
      id: 2,
      ...newProductData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    mockPrisma.product.create.mockResolvedValue(mockCreatedProduct);

    const createdProduct = await productService.createProduct(newProductData);

    expect(createdProduct.id).toBe(2);
    expect(createdProduct.barcode).toBe(newProductData.barcode);
    expect(mockPrisma.product.create).toHaveBeenCalledWith({
      data: {
        barcode: newProductData.barcode,
        sku: newProductData.sku,
        name: newProductData.name,
        costPrice: newProductData.costPrice
      }
    });
  });
});
