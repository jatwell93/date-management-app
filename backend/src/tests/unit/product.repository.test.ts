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
      findMany: jest.Mock;
    };
  };
  let repository: ProductRepository;

  beforeEach(() => {
    prisma = {
      product: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
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

  it('rejects ambiguous SKU and barcode matches to different products', async () => {
    const barcodeRecord = {
      ...productRecord,
      id: 2,
      sku: 'SKU-2',
      barcode: 'BAR-2',
    };
    prisma.product.findUnique
      .mockResolvedValueOnce(productRecord)
      .mockResolvedValueOnce(barcodeRecord);

    await expect(
      repository.findFirstBySkuOrBarcode('SKU-1', 'BAR-2', organizationId),
    ).rejects.toThrow('Duplicate identifiers detected');
  });

  it('finds excess products for deletion priority within an organization', async () => {
    prisma.product.findMany.mockResolvedValue([productRecord]);

    const result = await repository.findExcessProductsByOrganization(organizationId, 5);

    expect(result).toEqual([productRecord]);
    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      skip: 5,
      include: {
        _count: {
          select: { inventoryItems: true },
        },
      },
    });
  });
});
