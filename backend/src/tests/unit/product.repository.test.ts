import { ProductRepository } from '../../repositories/product.repository';

describe('ProductRepository', () => {
  const organizationId = 'org-123';
  const now = new Date('2026-01-01T00:00:00.000Z');

  const productRecord = {
    id: 1,
    organizationId,
    barcode: 'BAR-1',
    sku: 'SKU-1',
    name: 'Test Product',
    costPrice: 10,
    notes: '',
    createdAt: now,
    updatedAt: now,
  };

  let prisma: {
    product: {
      findUnique: jest.Mock;
    };
  };
  let repository: ProductRepository;

  beforeEach(() => {
    prisma = {
      product: {
        findUnique: jest.fn(),
      },
    };
    repository = new ProductRepository(prisma as never);
  });

  it('looks up products by SKU and barcode within an organization', async () => {
    prisma.product.findUnique.mockResolvedValueOnce(productRecord).mockResolvedValueOnce(null);

    const result = await repository.findBySkuOrBarcode('SKU-1', 'BAR-1', organizationId);

    expect(result).toEqual({ bySku: productRecord, byBarcode: null });
    expect(prisma.product.findUnique).toHaveBeenNthCalledWith(1, {
      where: {
        organizationId_sku: {
          organizationId,
          sku: 'SKU-1',
        },
      },
    });
    expect(prisma.product.findUnique).toHaveBeenNthCalledWith(2, {
      where: {
        organizationId_barcode: {
          organizationId,
          barcode: 'BAR-1',
        },
      },
    });
  });
});
