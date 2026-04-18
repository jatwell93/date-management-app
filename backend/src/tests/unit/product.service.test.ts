import fs from 'fs';
import { PrismaClient } from '@prisma/client';

const mockXlsxReadFile = jest.fn();
const mockXlsxSheetToJson = jest.fn();
const mockCsvParse = jest.fn();

jest.mock('xlsx', () => ({
  readFile: (...args: unknown[]) => mockXlsxReadFile(...args),
  utils: {
    sheet_to_json: (...args: unknown[]) => mockXlsxSheetToJson(...args),
  },
}));

jest.mock('csv-parse', () => ({
  parse: (...args: unknown[]) => mockCsvParse(...args),
}));

import {
  ProductService,
  extractCostValue,
  extractCostValueEnhanced,
} from '../../services/product.service';

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

  describe('cost parser helpers', () => {
    it('extractCostValue handles currency symbols and thousands separators', () => {
      expect(extractCostValue('$1,234.50')).toBe(1234.5);
      expect(extractCostValue('12,99')).toBe(12.99);
      expect(extractCostValue('1,234')).toBe(1234);
    });

    it('extractCostValue returns null for non-numeric input', () => {
      expect(extractCostValue('not-a-number')).toBeNull();
    });

    it('extractCostValueEnhanced handles negative, european, and mixed separators', () => {
      expect(extractCostValueEnhanced('$(12.34)')).toBe(-12.34);
      expect(extractCostValueEnhanced('1.234,56')).toBe(1234.56);
      expect(extractCostValueEnhanced('1,000,000')).toBe(1000000);
      expect(extractCostValueEnhanced('12.34.56')).toBe(1234.56);
      expect(extractCostValueEnhanced('abc')).toBeNull();
    });
  });

  describe('processCSVUpload file-type routing', () => {
    it('routes to XLSX processor when original filename is .xlsx', async () => {
      const processXLSXSpy = jest
        .spyOn(productService as any, 'processXLSXUpload')
        .mockResolvedValue({ imported: 1, updated: 0, errors: [] });
      const processCSVSpy = jest
        .spyOn(productService as any, 'processCSVUploadInternal')
        .mockResolvedValue({ imported: 0, updated: 0, errors: [] });

      const result = await productService.processCSVUpload('/tmp/upload-no-ext', 'products.xlsx');

      expect(result).toEqual({ imported: 1, updated: 0, errors: [] });
      expect(processXLSXSpy).toHaveBeenCalledWith('/tmp/upload-no-ext');
      expect(processCSVSpy).not.toHaveBeenCalled();
    });

    it('routes to CSV processor when file-type detection falls back after header read error', async () => {
      const processXLSXSpy = jest
        .spyOn(productService as any, 'processXLSXUpload')
        .mockResolvedValue({ imported: 1, updated: 0, errors: [] });
      const processCSVSpy = jest
        .spyOn(productService as any, 'processCSVUploadInternal')
        .mockResolvedValue({ imported: 0, updated: 2, errors: [] });
      const fsOpenSpy = jest.spyOn(fs.promises, 'open').mockRejectedValue(new Error('open failed'));
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const result = await productService.processCSVUpload('/tmp/upload-no-ext');

      expect(result).toEqual({ imported: 0, updated: 2, errors: [] });
      expect(fsOpenSpy).toHaveBeenCalledWith('/tmp/upload-no-ext', 'r');
      expect(processCSVSpy).toHaveBeenCalledWith('/tmp/upload-no-ext');
      expect(processXLSXSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('routes to XLSX processor when binary header indicates zip archive', async () => {
      const processXLSXSpy = jest
        .spyOn(productService as any, 'processXLSXUpload')
        .mockResolvedValue({ imported: 3, updated: 0, errors: [] });
      const processCSVSpy = jest
        .spyOn(productService as any, 'processCSVUploadInternal')
        .mockResolvedValue({ imported: 0, updated: 0, errors: [] });

      const handle = {
        read: jest.fn(async (buffer: Buffer) => {
          Buffer.from('PK12').copy(buffer, 0);
          return { bytesRead: 4, buffer };
        }),
        close: jest.fn(async () => undefined),
      };
      const fsOpenSpy = jest.spyOn(fs.promises, 'open').mockResolvedValue(handle as any);

      const result = await productService.processCSVUpload('/tmp/upload-no-ext');

      expect(result).toEqual({ imported: 3, updated: 0, errors: [] });
      expect(fsOpenSpy).toHaveBeenCalledWith('/tmp/upload-no-ext', 'r');
      expect(handle.read).toHaveBeenCalled();
      expect(handle.close).toHaveBeenCalled();
      expect(processXLSXSpy).toHaveBeenCalledWith('/tmp/upload-no-ext');
      expect(processCSVSpy).not.toHaveBeenCalled();
    });
  });

  describe('XLSX upload processing paths', () => {
    it('returns validation error when workbook has no data rows', async () => {
      mockXlsxReadFile.mockReturnValue({
        SheetNames: ['Sheet1'],
        Sheets: { Sheet1: {} },
      });
      mockXlsxSheetToJson.mockReturnValue([['SKU', 'Name', 'Cost', 'Barcode']]);

      const result = await (productService as any).processXLSXUpload('/tmp/no-data.xlsx');

      expect(result.imported).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.errors).toContain('XLSX file is empty or has no data rows');
    });

    it('returns header validation error when SKU column is missing', async () => {
      mockXlsxReadFile.mockReturnValue({
        SheetNames: ['Sheet1'],
        Sheets: { Sheet1: {} },
      });
      mockXlsxSheetToJson.mockReturnValue([
        ['Name', 'Cost', 'Barcode'],
        ['Product A', '10.00', '111'],
      ]);

      const result = await (productService as any).processXLSXUpload('/tmp/missing-sku.xlsx');

      expect(result.imported).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.errors[0]).toContain('Missing required column for SKU');
    });

    it('returns unexpected-columns error when headers include unsupported fields', async () => {
      mockXlsxReadFile.mockReturnValue({
        SheetNames: ['Sheet1'],
        Sheets: { Sheet1: {} },
      });
      mockXlsxSheetToJson.mockReturnValue([
        ['SKU', 'Name', 'Cost', 'Barcode', 'Unexpected Column'],
        ['SKU-1', 'Product A', '10.00', '111', 'oops'],
      ]);

      const result = await (productService as any).processXLSXUpload('/tmp/unexpected-column.xlsx');

      expect(result.imported).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.errors[0]).toContain('Unexpected columns found');
    });

    it('updates existing product and creates new product from XLSX rows', async () => {
      mockXlsxReadFile.mockReturnValue({
        SheetNames: ['Sheet1'],
        Sheets: { Sheet1: {} },
      });
      mockXlsxSheetToJson.mockReturnValue([
        ['SKU', 'Name', 'Cost', 'Barcode'],
        ['SKU-1', 'Existing Product Updated', '11.00', 'BAR-1'],
        ['SKU-2', 'New Product', '12.50', 'BAR-2'],
      ]);

      jest.spyOn(productService, 'getAllProducts').mockResolvedValue([
        {
          id: 1,
          organizationId,
          sku: 'SKU-1',
          barcode: 'BAR-1',
          name: 'Existing Product',
          costPrice: 10,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
      jest.spyOn(productService, 'updateProduct').mockResolvedValue({
        id: 1,
        organizationId,
        sku: 'SKU-1',
        barcode: 'BAR-1',
        name: 'Existing Product Updated',
        costPrice: 11,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      jest.spyOn(productService, 'createProduct').mockResolvedValue({
        id: 2,
        organizationId,
        sku: 'SKU-2',
        barcode: 'BAR-2',
        name: 'New Product',
        costPrice: 12.5,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const result = await (productService as any).processXLSXUpload('/tmp/success.xlsx');

      expect(result).toEqual({ imported: 1, updated: 1, errors: [] });
    });
  });

  describe('private lookup helpers', () => {
    it('throws duplicate identifier error when SKU and barcode match different products', async () => {
      mockPrisma.product.findUnique
        .mockResolvedValueOnce({
          id: 1,
          organizationId,
          sku: 'SKU-1',
          barcode: 'BAR-1',
          name: 'One',
          costPrice: 1,
          notes: '',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 2,
          organizationId,
          sku: 'SKU-2',
          barcode: 'BAR-2',
          name: 'Two',
          costPrice: 2,
          notes: '',
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      await expect(
        (productService as any).getProductBySkuOrBarcode('SKU-1', 'BAR-2'),
      ).rejects.toThrow('Duplicate identifiers detected');
    });

    it('returns product found by barcode when SKU lookup misses', async () => {
      const byBarcode = {
        id: 22,
        organizationId,
        sku: 'SKU-22',
        barcode: 'BAR-22',
        name: 'By Barcode',
        costPrice: 22,
        notes: '',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      };

      mockPrisma.product.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(byBarcode);

      const result = await (productService as any).getProductBySkuOrBarcode(
        'SKU-MISSING',
        'BAR-22',
      );

      expect(result).toEqual({
        id: 22,
        organizationId,
        sku: 'SKU-22',
        barcode: 'BAR-22',
        name: 'By Barcode',
        costPrice: 22,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      });
    });
  });

  describe('CSV internal processing and validation helpers', () => {
    const setupStreamEmitter = () => {
      const handlers: Record<string, (...args: any[]) => void> = {};
      const emitter = {
        on: jest.fn((event: string, cb: (...args: any[]) => void) => {
          handlers[event] = cb;
          return emitter;
        }),
      };

      jest.spyOn(fs, 'createReadStream').mockReturnValue({
        pipe: jest.fn(() => emitter),
      } as any);
      mockCsvParse.mockReturnValue({});

      return handlers;
    };

    it('processCSVUploadInternal returns validation errors when CSV structure is invalid', async () => {
      jest.spyOn(productService as any, 'validateCSVStructure').mockResolvedValue({
        isValid: false,
        errors: ['Missing required column header for SKU.'],
      });

      const result = await productService.processCSVUploadInternal('/tmp/invalid-structure.csv');

      expect(result).toEqual({
        imported: 0,
        updated: 0,
        errors: ['Missing required column header for SKU.'],
      });
    });

    it('processCSVUploadInternal rejects when CSV parser emits error', async () => {
      jest.spyOn(productService as any, 'validateCSVStructure').mockResolvedValue({
        isValid: true,
        errors: [],
      });

      const handlers = setupStreamEmitter();
      const promise = productService.processCSVUploadInternal('/tmp/parser-error.csv');

      await Promise.resolve();

      handlers.error(new Error('malformed csv'));

      await expect(promise).rejects.toEqual({
        imported: 0,
        updated: 0,
        errors: ['CSV parsing error: malformed csv'],
      });
    });

    it('processCSVUploadInternal returns empty-file error when no records are parsed', async () => {
      jest.spyOn(productService as any, 'validateCSVStructure').mockResolvedValue({
        isValid: true,
        errors: [],
      });

      const handlers = setupStreamEmitter();
      const promise = productService.processCSVUploadInternal('/tmp/empty.csv');

      await Promise.resolve();

      await handlers.end();
      const result = await promise;

      expect(result).toEqual({
        imported: 0,
        updated: 0,
        errors: ['CSV file is empty or contains no valid records'],
      });
    });

    it('processCSVUploadInternal updates and creates products from parsed rows', async () => {
      jest.spyOn(productService as any, 'validateCSVStructure').mockResolvedValue({
        isValid: true,
        errors: [],
      });

      const existingProduct = {
        id: 7,
        organizationId,
        sku: 'SKU-EXIST',
        barcode: 'BAR-EXIST',
        name: 'Existing',
        costPrice: 9.99,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      jest
        .spyOn(productService as any, 'getProductBySkuOrBarcode')
        .mockResolvedValueOnce(existingProduct)
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('Duplicate identifiers detected'));
      jest.spyOn(productService, 'updateProduct').mockResolvedValue(existingProduct as any);
      jest.spyOn(productService, 'createProduct').mockResolvedValue({
        ...existingProduct,
        id: 8,
        sku: 'SKU-NEW',
        barcode: 'BAR-NEW',
      } as any);

      const handlers = setupStreamEmitter();
      const promise = productService.processCSVUploadInternal('/tmp/data.csv');

      await Promise.resolve();

      handlers.data({
        SKU: 'SKU-EXIST',
        Name: 'Existing Updated',
        Cost: '10.00',
        Barcode: 'BAR-EXIST',
      });
      handlers.data({ SKU: 'SKU-NEW', Name: 'New Product', Cost: '11.25', Barcode: 'BAR-NEW' });
      handlers.data({ SKU: 'SKU-DUP', Name: 'Dup', Cost: '5.00', Barcode: 'BAR-DUP' });
      await handlers.end();

      const result = await promise;

      expect(result.imported).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.errors).toContain('Row 3: Duplicate identifiers detected');
      expect(productService.updateProduct).toHaveBeenCalled();
      expect(productService.createProduct).toHaveBeenCalled();
    });

    it('validateCSVStructure marks CSV invalid when parser emits an error', async () => {
      const handlers = setupStreamEmitter();
      const promise = (productService as any).validateCSVStructure('/tmp/bad.csv');

      handlers.error(new Error('bad header row'));

      await expect(promise).resolves.toEqual({
        isValid: false,
        errors: ['CSV structure validation error: bad header row'],
      });
    });

    it('validateCSVStructure returns missing-header errors when required columns are absent', async () => {
      const handlers = setupStreamEmitter();
      const promise = (productService as any).validateCSVStructure('/tmp/missing-headers.csv');

      handlers.data({ WrongA: '1', WrongB: '2' }, 0);
      handlers.end();

      const result = await promise;
      expect(result.isValid).toBe(false);
      expect(
        result.errors.some((e: string) => e.includes('Missing required column header for SKU')),
      ).toBe(true);
      expect(
        result.errors.some((e: string) => e.includes('Missing required column header for Name')),
      ).toBe(true);
      expect(
        result.errors.some((e: string) => e.includes('Missing required column header for Cost')),
      ).toBe(true);
      expect(
        result.errors.some((e: string) => e.includes('Missing required column header for Barcode')),
      ).toBe(true);
    });

    it('validateCSVStructure returns valid when required headers are present via alternatives', async () => {
      const handlers = setupStreamEmitter();
      const promise = (productService as any).validateCSVStructure('/tmp/valid-headers.csv');

      handlers.data(
        {
          'Item Code': 'SKU-1',
          'Product Name': 'Name',
          'Unit Price': '10.00',
          EAN: '12345',
        },
        0,
      );
      handlers.end();

      await expect(promise).resolves.toEqual({ isValid: true, errors: [] });
    });
  });
});
