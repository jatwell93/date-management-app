import fs from 'fs';
import { PrismaClient } from '@prisma/client';

const mockXlsxReadFile = vi.fn();
const mockXlsxSheetToJson = vi.fn();
const mockCsvParse = vi.fn();
const realXlsx = await vi.importActual<typeof import('xlsx')>('xlsx');

vi.mock('xlsx', () => ({
  readFile: (...args: unknown[]) => mockXlsxReadFile(...args),
  utils: {
    sheet_to_json: (...args: unknown[]) => mockXlsxSheetToJson(...args),
  },
}));

vi.mock('csv-parse', () => ({
  parse: (...args: unknown[]) => mockCsvParse(...args),
}));

import {
  ProductService,
  extractCostValue,
  extractCostValueEnhanced,
} from '../../services/product.service';

// Mirrors ProductRepository.creditContextInclude — the relations findAll now loads so
// mapPrismaToModel can resolve an accurate creditScope on the GET /products list.
const creditContextInclude = {
  supplier: true,
  brand: { include: { supplier: true } },
};

describe('ProductService with organizationId', () => {
  let productService: ProductService;
  let mockPrisma: any;
  const organizationId = 'org-123';

  const writeXlsxFixture = (filePath: string, rows: unknown[][]) => {
    fs.mkdirSync('/tmp', { recursive: true });
    const workbook = realXlsx.utils.book_new();
    const worksheet = realXlsx.utils.aoa_to_sheet(rows);
    realXlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    realXlsx.writeFile(workbook, filePath);
  };

  beforeEach(() => {
    mockPrisma = {
      product: {
        create: vi.fn(),
        update: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        delete: vi.fn(),
      },
      organizationUsage: {
        findUnique: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
      },
      $transaction: vi.fn((callback) => callback(mockPrisma)),
    };
    productService = new ProductService(mockPrisma as unknown as PrismaClient, organizationId);
  });

  afterEach(() => {
    vi.clearAllMocks();
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
        include: creditContextInclude,
      });
    });

    it('should apply limit and offset when provided', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);

      await productService.getAllProducts(10, 20);

      expect(mockPrisma.product.findMany).toHaveBeenCalledWith({
        where: {
          organizationId,
        },
        include: creditContextInclude,
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
        include: {
          supplier: true,
          brand: { include: { supplier: true } },
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
        include: {
          supplier: true,
          brand: { include: { supplier: true } },
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

      mockPrisma.product.findFirst.mockResolvedValue(mockProduct);

      const product = await productService.getProductByBarcode('123456789');

      expect(product).not.toBeNull();
      expect(product?.barcode).toBe('123456789');
      expect(mockPrisma.product.findFirst).toHaveBeenCalledWith({
        where: { barcode: '123456789', organizationId },
        include: {
          supplier: true,
          brand: { include: { supplier: true } },
        },
      });
    });

    it('projects full-credit context from an organization-owned direct supplier', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({
        id: 1,
        organizationId,
        barcode: '123456789',
        sku: 'TEST-001',
        name: 'Test Product',
        costPrice: 10.99,
        notes: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        supplier: {
          id: 9,
          organizationId,
          name: 'Direct Supplier',
          creditType: 'FULL_CREDIT',
          creditPolicyNote: 'Return monthly',
        },
        brand: null,
      });

      await expect(productService.getProductByBarcode('123456789')).resolves.toMatchObject({
        creditScope: 'FULL_CREDIT',
        creditScopeReason: 'FULL_CREDIT',
        creditSupplierId: 9,
        creditSupplierName: 'Direct Supplier',
      });
    });

    it('ignores a malformed cross-organization supplier relation', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({
        id: 1,
        organizationId,
        barcode: '123456789',
        sku: 'TEST-001',
        name: 'Test Product',
        costPrice: 10.99,
        notes: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        supplier: {
          id: 99,
          organizationId: 'other-org',
          name: 'Other Tenant',
          creditType: 'FULL_CREDIT',
          creditPolicyNote: 'Return monthly',
        },
        brand: null,
      });

      await expect(productService.getProductByBarcode('123456789')).resolves.toMatchObject({
        creditScope: 'NO_CREDIT',
        creditScopeReason: 'NEEDS_BRAND',
        creditSupplierId: null,
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
        include: {
          supplier: true,
          brand: { include: { supplier: true } },
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
          retailPrice: null,
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
        include: creditContextInclude,
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
        include: creditContextInclude,
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
      const processXLSXSpy = vi
        .spyOn(productService as any, 'processXLSXUpload')
        .mockResolvedValue({ imported: 1, updated: 0, errors: [] });
      const processCSVSpy = vi
        .spyOn(productService as any, 'processCSVUploadInternal')
        .mockResolvedValue({ imported: 0, updated: 0, errors: [] });

      const result = await productService.processCSVUpload('/tmp/upload-no-ext', 'products.xlsx');

      expect(result).toEqual({ imported: 1, updated: 0, errors: [] });
      expect(processXLSXSpy).toHaveBeenCalledWith('/tmp/upload-no-ext');
      expect(processCSVSpy).not.toHaveBeenCalled();
    });

    it('routes to CSV processor when file-type detection falls back after header read error', async () => {
      const processXLSXSpy = vi
        .spyOn(productService as any, 'processXLSXUpload')
        .mockResolvedValue({ imported: 1, updated: 0, errors: [] });
      const processCSVSpy = vi
        .spyOn(productService as any, 'processCSVUploadInternal')
        .mockResolvedValue({ imported: 0, updated: 2, errors: [] });
      const fsOpenSpy = vi.spyOn(fs.promises, 'open').mockRejectedValue(new Error('open failed'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const result = await productService.processCSVUpload('/tmp/upload-no-ext');

      expect(result).toEqual({ imported: 0, updated: 2, errors: [] });
      expect(fsOpenSpy).toHaveBeenCalledWith('/tmp/upload-no-ext', 'r');
      expect(processCSVSpy).toHaveBeenCalledWith('/tmp/upload-no-ext');
      expect(processXLSXSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('routes to XLSX processor when binary header indicates zip archive', async () => {
      const processXLSXSpy = vi
        .spyOn(productService as any, 'processXLSXUpload')
        .mockResolvedValue({ imported: 3, updated: 0, errors: [] });
      const processCSVSpy = vi
        .spyOn(productService as any, 'processCSVUploadInternal')
        .mockResolvedValue({ imported: 0, updated: 0, errors: [] });

      const handle = {
        read: vi.fn(async (buffer: Buffer) => {
          Buffer.from('PK12').copy(buffer, 0);
          return { bytesRead: 4, buffer };
        }),
        close: vi.fn(async () => undefined),
      };
      const fsOpenSpy = vi.spyOn(fs.promises, 'open').mockResolvedValue(handle as any);

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
      writeXlsxFixture('/tmp/no-data.xlsx', [['SKU', 'Name', 'Cost', 'Barcode']]);
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
      writeXlsxFixture('/tmp/missing-sku.xlsx', [
        ['Name', 'Cost', 'Barcode'],
        ['Product A', '10.00', '111'],
      ]);
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

    it('does not advertise retail headers as Cost alternatives when XLSX cost is missing', async () => {
      writeXlsxFixture('/tmp/missing-cost-retail.xlsx', [
        ['SKU', 'Name', 'Retail Price', 'Barcode'],
        ['SKU-1', 'Product A', '15.00', '111'],
      ]);
      mockXlsxReadFile.mockReturnValue({
        SheetNames: ['Sheet1'],
        Sheets: { Sheet1: {} },
      });
      mockXlsxSheetToJson.mockReturnValue([
        ['SKU', 'Name', 'Retail Price', 'Barcode'],
        ['SKU-1', 'Product A', '15.00', '111'],
      ]);

      const result = await (productService as any).processXLSXUpload(
        '/tmp/missing-cost-retail.xlsx',
      );

      expect(result.errors[0]).toContain('Missing required column for Cost');
      expect(result.errors[0]).not.toContain('Selling Price');
      expect(result.errors[0]).not.toContain('Retail Price');
    });

    it('returns unexpected-columns error when headers include unsupported fields', async () => {
      writeXlsxFixture('/tmp/unexpected-column.xlsx', [
        ['SKU', 'Name', 'Cost', 'Barcode', 'Unexpected Column'],
        ['SKU-1', 'Product A', '10.00', '111', 'oops'],
      ]);
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
      writeXlsxFixture('/tmp/success.xlsx', [
        ['SKU', 'Name', 'Cost', 'Retail Price', 'Barcode'],
        ['SKU-1', 'Existing Product Updated', '11.00', '19.99', 'BAR-1'],
        ['SKU-2', 'New Product', '12.50', '24.99', 'BAR-2'],
      ]);
      mockXlsxReadFile.mockReturnValue({
        SheetNames: ['Sheet1'],
        Sheets: { Sheet1: {} },
      });
      mockXlsxSheetToJson.mockReturnValue([
        ['SKU', 'Name', 'Cost', 'Retail Price', 'Barcode'],
        ['SKU-1', 'Existing Product Updated', '11.00', '19.99', 'BAR-1'],
        ['SKU-2', 'New Product', '12.50', '24.99', 'BAR-2'],
      ]);

      vi.spyOn(productService, 'getAllProducts').mockResolvedValue([
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
      vi.spyOn(productService, 'updateProduct').mockResolvedValue({
        id: 1,
        organizationId,
        sku: 'SKU-1',
        barcode: 'BAR-1',
        name: 'Existing Product Updated',
        costPrice: 11,
        retailPrice: 19.99,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      vi.spyOn(productService, 'createProduct').mockResolvedValue({
        id: 2,
        organizationId,
        sku: 'SKU-2',
        barcode: 'BAR-2',
        name: 'New Product',
        costPrice: 12.5,
        retailPrice: 24.99,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const result = await (productService as any).processXLSXUpload('/tmp/success.xlsx');

      expect(result).toEqual({ imported: 1, updated: 1, errors: [] });
      expect(productService.updateProduct).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ retailPrice: 19.99 }),
      );
      expect(productService.createProduct).toHaveBeenCalledWith(
        expect.objectContaining({ retailPrice: 24.99 }),
      );
    });
  });

  describe('CSV internal processing and validation helpers', () => {
    const setupStreamEmitter = () => {
      const handlers: Record<string, (...args: any[]) => void> = {};
      const emitter = {
        on: vi.fn((event: string, cb: (...args: any[]) => void) => {
          handlers[event] = cb;
          return emitter;
        }),
      };

      vi.spyOn(fs, 'createReadStream').mockReturnValue({
        pipe: vi.fn(() => emitter),
      } as any);
      mockCsvParse.mockReturnValue({});

      return handlers;
    };

    it('processCSVUploadInternal returns validation errors when CSV structure is invalid', async () => {
      vi.spyOn(productService as any, 'validateCSVStructure').mockResolvedValue({
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
      vi.spyOn(productService as any, 'validateCSVStructure').mockResolvedValue({
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
      vi.spyOn(productService as any, 'validateCSVStructure').mockResolvedValue({
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
      vi.spyOn(productService as any, 'validateCSVStructure').mockResolvedValue({
        isValid: true,
        errors: [],
      });

      const now = new Date();
      const existingPrismaProduct = {
        id: 7,
        organizationId,
        sku: 'SKU-EXIST',
        barcode: 'BAR-EXIST',
        name: 'Existing',
        costPrice: 9.99,
        notes: '',
        createdAt: now,
        updatedAt: now,
      };
      const existingProduct = {
        id: 7,
        organizationId,
        sku: 'SKU-EXIST',
        barcode: 'BAR-EXIST',
        name: 'Existing',
        costPrice: 9.99,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      // Two distinct products so resolveProductImportOperation detects a conflict on row 3
      const conflictBySku = {
        id: 1,
        organizationId,
        sku: 'SKU-DUP',
        barcode: 'BAR-OTHER',
        name: 'Conflict A',
        costPrice: 5,
        notes: '',
        createdAt: now,
        updatedAt: now,
      };
      const conflictByBarcode = {
        id: 2,
        organizationId,
        sku: 'SKU-OTHER',
        barcode: 'BAR-DUP',
        name: 'Conflict B',
        costPrice: 5,
        notes: '',
        createdAt: now,
        updatedAt: now,
      };

      vi.spyOn((productService as any)['productRepo'], 'findBySkuOrBarcode')
        .mockResolvedValueOnce({ bySku: existingPrismaProduct, byBarcode: null })
        .mockResolvedValueOnce({ bySku: null, byBarcode: null })
        .mockResolvedValueOnce({ bySku: conflictBySku, byBarcode: conflictByBarcode });
      vi.spyOn(productService, 'updateProduct').mockResolvedValue(existingProduct as any);
      vi.spyOn(productService, 'createProduct').mockResolvedValue({
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
        'Retail Price': '20.00',
        Barcode: 'BAR-EXIST',
      });
      handlers.data({
        SKU: 'SKU-NEW',
        Name: 'New Product',
        Cost: '11.25',
        'Retail Price': '22.50',
        Barcode: 'BAR-NEW',
      });
      handlers.data({ SKU: 'SKU-DUP', Name: 'Dup', Cost: '5.00', Barcode: 'BAR-DUP' });
      await handlers.end();

      const result = await promise;

      expect(result.imported).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('Row 3: Duplicate identifiers detected')]),
      );
      expect(productService.updateProduct).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ retailPrice: 20 }),
      );
      expect(productService.createProduct).toHaveBeenCalledWith(
        expect.objectContaining({ retailPrice: 22.5 }),
      );
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

    it('does not advertise retail headers as Cost alternatives when CSV cost is missing', async () => {
      const handlers = setupStreamEmitter();
      const promise = (productService as any).validateCSVStructure('/tmp/missing-cost.csv');

      handlers.data(
        {
          SKU: 'SKU-1',
          Name: 'Name',
          'Retail Price': '15.00',
          Barcode: '12345',
        },
        0,
      );
      handlers.end();

      const result = await promise;
      const costError = result.errors.find((e: string) =>
        e.includes('Missing required column header for Cost'),
      );
      expect(costError).toBeDefined();
      expect(costError).not.toContain('Selling Price');
      expect(costError).not.toContain('Retail Price');
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
