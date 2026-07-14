import type { PrismaClient } from '@prisma/client';
import { SupplierCreditRepository } from '../../repositories/supplier-credit.repository';

function makeRepository(options: {
  candidates?: Array<{
    id: number;
    barcode: string | null;
    apiSku: string | null;
    sigmaSku: string | null;
    ch2Sku: string | null;
    brandName: string;
    manufacturerName: string | null;
  }>;
  brand?: { id: number; source: string } | null;
}) {
  const tx = {
    $queryRaw: vi.fn(async () => options.candidates ?? []),
    brand: {
      findUnique: vi.fn(async () => options.brand ?? null),
      create: vi.fn(async () => ({ id: 41, source: 'REFERENCE' })),
      update: vi.fn(async () => ({ id: 41, source: 'REFERENCE' })),
    },
    product: { updateMany: vi.fn(async () => ({ count: 1 })) },
    catalogueCorrection: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 51 })),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  } as unknown as PrismaClient;
  return { repository: new SupplierCreditRepository(prisma), tx };
}

describe('SupplierCreditRepository catalogue enrichment', () => {
  it('falls back to a normalized wholesaler SKU when the barcode has no catalogue match', async () => {
    const { repository, tx } = makeRepository({
      candidates: [
        {
          id: 1,
          barcode: 'CATALOGUE-BARCODE',
          apiSku: 'API-100',
          sigmaSku: null,
          ch2Sku: null,
          brandName: 'Shared Brand',
          manufacturerName: 'Maker',
        },
      ],
    });

    await repository.enrichImportedProduct('org-a', {
      productId: 10,
      barcode: 'STORE-BARCODE',
      sku: ' api-100 ',
    });

    expect(tx.brand.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-a',
        name: 'Shared Brand',
        suggestedSupplierName: 'Maker',
        supplierId: null,
        source: 'REFERENCE',
      }),
      select: { id: true, source: true },
    });
    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: { id: 10, organizationId: 'org-a' },
      data: { brandId: 41 },
    });
    expect(tx.catalogueCorrection.create).not.toHaveBeenCalled();
  });

  it('treats an ambiguous normalized SKU as unmatched', async () => {
    const candidates = [1, 2].map((id) => ({
      id,
      barcode: `CAT-${id}`,
      apiSku: id === 1 ? 'DUPLICATE' : null,
      sigmaSku: id === 2 ? ' duplicate ' : null,
      ch2Sku: null,
      brandName: `Brand ${id}`,
      manufacturerName: `Maker ${id}`,
    }));
    const { repository, tx } = makeRepository({ candidates });

    await repository.enrichImportedProduct('org-a', {
      productId: 10,
      barcode: 'STORE-BARCODE',
      sku: 'duplicate',
    });

    expect(tx.brand.create).not.toHaveBeenCalled();
    expect(tx.product.updateMany).not.toHaveBeenCalled();
    expect(tx.catalogueCorrection.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-a',
        productId: 10,
        barcode: 'STORE-BARCODE',
        kind: 'UNMATCHED',
        status: 'PENDING',
      },
    });
  });

  it('reuses an existing confirmed brand without overwriting its advisory fields', async () => {
    const { repository, tx } = makeRepository({
      candidates: [
        {
          id: 1,
          barcode: 'CAT-BARCODE',
          apiSku: null,
          sigmaSku: null,
          ch2Sku: null,
          brandName: 'Existing Brand',
          manufacturerName: 'New Suggestion',
        },
      ],
      brand: { id: 77, source: 'CONFIRMED' },
    });

    await repository.enrichImportedProduct('org-a', {
      productId: 10,
      barcode: 'CAT-BARCODE',
      sku: 'SKU',
    });

    expect(tx.brand.create).not.toHaveBeenCalled();
    expect(tx.brand.update).not.toHaveBeenCalled();
    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: { id: 10, organizationId: 'org-a' },
      data: { brandId: 77 },
    });
  });
});
