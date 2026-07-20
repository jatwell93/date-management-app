import type { PrismaClient } from '@prisma/client';
import { SupplierCreditRepository } from '../../repositories/supplier-credit.repository';

describe('SupplierCreditRepository brand-review parity', () => {
  // Regression: ISSUE-QA-002/004 — Express returned raw Prisma products instead of Worker DTOs
  // Found by /qa on 2026-07-17
  // Report: Browser QA for enhance-supplier-policy-capture
  it('maps product IDs and names to the shared Worker/frontend response contract', async () => {
    const rows = [
      {
        id: 301,
        organizationId: 'org-a',
        barcode: '930000000001',
        sku: 'QA-SKU-001',
        name: 'QA Product One',
        brand: null,
        supplier: null,
      },
      {
        id: 302,
        organizationId: 'org-a',
        barcode: '930000000002',
        sku: 'QA-SKU-002',
        name: 'QA Product Two',
        brand: {
          id: 41,
          name: 'QA Brand',
          manufacturerName: 'QA Maker',
          suggestedSupplierName: 'QA Supplier',
          supplierId: 7,
          source: 'CONFIRMED',
          supplier: { id: 7 },
        },
        supplier: null,
      },
    ];
    const prisma = { product: { findMany: vi.fn(async () => rows) } } as unknown as PrismaClient;
    const repository = new SupplierCreditRepository(prisma);

    const result = await repository.reviewBrands('org-a', { limit: 1 });

    expect(result).toEqual({
      items: [
        {
          productId: 301,
          sku: 'QA-SKU-001',
          barcode: '930000000001',
          productName: 'QA Product One',
          brand: null,
        },
      ],
      nextCursor: 301,
    });
  });
});
