import {
  BRAND_SOURCES,
  CORRECTION_KINDS,
  CORRECTION_STATUSES,
  matchByBarcode,
  matchByWholesalerSku,
  matchCatalogueEntry,
  normalizeCatalogueSku,
  resolveSupplier,
  resolveSupplierContext,
  type CatalogueMatchEntry,
} from '../../../../shared/domain/brand-supplier';

import { resolveMarkdownCreditContext } from '../../../../shared/domain/markdown-credit-context';

const entries: CatalogueMatchEntry[] = [
  {
    id: 1,
    barcode: ' 9321299800449 ',
    apiSku: 'api-100',
    sigmaSku: ' SIG-100 ',
    ch2Sku: null,
  },
  {
    id: 2,
    barcode: '9300000000002',
    apiSku: 'DUPLICATE',
    sigmaSku: null,
    ch2Sku: 'ch2-200',
  },
  {
    id: 3,
    barcode: '9300000000003',
    apiSku: null,
    sigmaSku: ' duplicate ',
    ch2Sku: null,
  },
];

describe('brand-supplier shared domain', () => {
  it('pins the persisted source and correction vocabularies', () => {
    expect(BRAND_SOURCES).toEqual(['REFERENCE', 'USER_ADDED', 'CONFIRMED']);
    expect(CORRECTION_KINDS).toEqual(['UNMATCHED', 'BRAND_ADDED', 'SUPPLIER_OVERRIDE']);
    expect(CORRECTION_STATUSES).toEqual(['PENDING', 'ACCEPTED', 'REJECTED']);
  });

  describe('resolveSupplier', () => {
    it('prefers a product override over the brand supplier', () => {
      expect(resolveSupplier({ supplierId: 9 }, { supplierId: 4 })).toBe(9);
    });

    it('uses the confirmed brand supplier without a product override', () => {
      expect(resolveSupplier({ supplierId: null }, { supplierId: 4 })).toBe(4);
    });

    it('returns null when neither path resolves', () => {
      expect(resolveSupplier({ supplierId: null }, null)).toBeNull();
      expect(resolveSupplier({}, { supplierId: null })).toBeNull();
    });
  });

  describe('resolveSupplierContext', () => {
    const supplier = (id: number, hasPolicy = true, creditType = 'NONE') => ({
      id,
      name: `Supplier ${id}`,
      hasPolicy,
      creditType,
    });

    it('gives a direct product supplier precedence over the brand supplier', () => {
      expect(
        resolveSupplierContext({
          productSupplier: supplier(9),
          brand: { id: 1, name: 'Brand', source: 'CONFIRMED', supplier: supplier(4) },
        }),
      ).toMatchObject({ supplier: supplier(9), state: 'CLAIMABLE' });
    });

    it('uses a confirmed brand supplier when the product has no override', () => {
      expect(
        resolveSupplierContext({
          productSupplier: null,
          brand: { id: 1, name: 'Brand', source: 'CONFIRMED', supplier: supplier(4) },
        }),
      ).toMatchObject({ supplier: supplier(4), state: 'CLAIMABLE' });
    });

    it.each([
      ['NONE', 'NO_CREDIT', 'NO_CREDIT'],
      ['FULL_CREDIT', 'FULL_CREDIT', 'FULL_CREDIT'],
    ] as const)(
      'maps a confirmed supplier classified as %s to the matching scope and reason',
      (creditType, creditScope, creditScopeReason) => {
        const resolved = resolveSupplierContext({
          productSupplier: supplier(9, true, creditType),
          brand: null,
        });
        expect(resolveMarkdownCreditContext(resolved)).toEqual({
          creditScope,
          creditScopeReason,
          creditSupplierId: 9,
          creditSupplierName: 'Supplier 9',
        });
      },
    );

    it('keeps reference brands pending even when their suggested supplier is full credit', () => {
      const resolved = resolveSupplierContext({
        productSupplier: null,
        brand: {
          id: 1,
          name: 'Brand',
          source: 'REFERENCE',
          supplier: supplier(4, true, 'FULL_CREDIT'),
        },
      });
      expect(resolved).toMatchObject({
        supplier: supplier(4, true, 'FULL_CREDIT'),
        state: 'PENDING_CONFIRMATION',
      });
      expect(resolveMarkdownCreditContext(resolved)).toEqual({
        creditScope: 'NO_CREDIT',
        creditScopeReason: 'PENDING_CONFIRMATION',
        creditSupplierId: 4,
        creditSupplierName: 'Supplier 4',
      });
    });

    it('distinguishes missing policy and missing brand states', () => {
      expect(
        resolveMarkdownCreditContext(
          resolveSupplierContext({ productSupplier: supplier(9, false), brand: null }),
        ).creditScopeReason,
      ).toBe('NO_POLICY');
      expect(
        resolveMarkdownCreditContext(resolveSupplierContext({ productSupplier: null, brand: null }))
          .creditScopeReason,
      ).toBe('NEEDS_BRAND');
    });

    it('fails safe for unknown brand and credit enum values', () => {
      const context = resolveSupplierContext({
        productSupplier: null,
        brand: { id: 1, name: 'Brand', source: 'UNKNOWN', supplier: supplier(4, true, 'UNKNOWN') },
      });
      expect(resolveMarkdownCreditContext(context).creditScope).toBe('NO_CREDIT');
      expect(resolveMarkdownCreditContext(context).creditScopeReason).toBe('PENDING_CONFIRMATION');
    });
  });

  describe('catalogue matching', () => {
    it('normalizes wholesaler SKUs by trimming and uppercasing', () => {
      expect(normalizeCatalogueSku(' api-100 ')).toBe('API-100');
      expect(normalizeCatalogueSku('   ')).toBeNull();
      expect(normalizeCatalogueSku(null)).toBeNull();
    });

    it('matches a trimmed barcode before a colliding SKU', () => {
      expect(
        matchCatalogueEntry(entries, { barcode: ' 9321299800449 ', sku: 'DUPLICATE' })?.id,
      ).toBe(1);
      expect(matchByBarcode(entries, '9321299800449')?.id).toBe(1);
    });

    it.each([
      ['api-100', 1],
      ['sig-100', 1],
      [' CH2-200 ', 2],
    ])('falls back across API, Sigma, and CH2 for SKU %s', (sku, expectedId) => {
      expect(matchCatalogueEntry(entries, { barcode: '', sku })?.id).toBe(expectedId);
    });

    it('falls back to SKU when a nonblank barcode does not match', () => {
      expect(matchCatalogueEntry(entries, { barcode: 'not-present', sku: 'api-100' })?.id).toBe(1);
    });

    it('does not choose an arbitrary row for an ambiguous normalized SKU', () => {
      expect(matchByWholesalerSku(entries, ' duplicate ')).toBeNull();
      expect(matchCatalogueEntry(entries, { barcode: null, sku: 'duplicate' })).toBeNull();
    });

    it('completely excludes retired barcode and SKU candidates before matching', () => {
      const candidates = [
        {
          id: 10,
          barcode: '9300000000010',
          apiSku: 'SHARED',
          sigmaSku: null,
          ch2Sku: null,
          retiredAt: new Date('2026-07-01T00:00:00.000Z'),
        },
        {
          id: 11,
          barcode: '9300000000011',
          apiSku: 'SHARED',
          sigmaSku: null,
          ch2Sku: null,
          retiredAt: null,
        },
      ];

      expect(matchByBarcode(candidates, '9300000000010')).toBeNull();
      expect(matchByWholesalerSku(candidates, 'SHARED')?.id).toBe(11);
      expect(matchByWholesalerSku([...candidates].reverse(), 'SHARED')?.id).toBe(11);
    });

    it('keeps multiple active shared SKUs ambiguous after filtering retired rows', () => {
      const candidates = [
        {
          id: 10,
          barcode: '10',
          apiSku: 'SHARED',
          sigmaSku: null,
          ch2Sku: null,
          retiredAt: null,
        },
        {
          id: 11,
          barcode: '11',
          apiSku: 'SHARED',
          sigmaSku: null,
          ch2Sku: null,
          retiredAt: null,
        },
        {
          id: 12,
          barcode: '12',
          apiSku: 'SHARED',
          sigmaSku: null,
          ch2Sku: null,
          retiredAt: new Date(),
        },
      ];
      expect(matchByWholesalerSku(candidates, 'SHARED')).toBeNull();
    });

    it('treats blank barcode and SKU values as misses', () => {
      expect(matchByBarcode(entries, '   ')).toBeNull();
      expect(matchByWholesalerSku(entries, '')).toBeNull();
      expect(matchCatalogueEntry(entries, { barcode: ' ', sku: ' ' })).toBeNull();
    });
  });
});
