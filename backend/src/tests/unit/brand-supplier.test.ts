import {
  BRAND_SOURCES,
  CORRECTION_KINDS,
  CORRECTION_STATUSES,
  matchByBarcode,
  matchByWholesalerSku,
  matchCatalogueEntry,
  normalizeCatalogueSku,
  resolveSupplier,
  type CatalogueMatchEntry,
} from '../../../../shared/domain/brand-supplier';

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

    it('treats blank barcode and SKU values as misses', () => {
      expect(matchByBarcode(entries, '   ')).toBeNull();
      expect(matchByWholesalerSku(entries, '')).toBeNull();
      expect(matchCatalogueEntry(entries, { barcode: ' ', sku: ' ' })).toBeNull();
    });
  });
});
