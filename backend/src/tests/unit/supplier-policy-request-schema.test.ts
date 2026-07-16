import {
  bulkAttachPolicySchema,
  bulkLinkProductsSchema,
  supplierCreateSchema,
  supplierPatchSchema,
  supplierUpdateSchema,
} from '../../schemas';

describe('supplier policy request schemas', () => {
  it('accepts the documented supplier field limits', () => {
    expect(
      supplierCreateSchema.safeParse({
        body: {
          name: 'Supplier',
          creditPolicyNote: 'x'.repeat(10_000),
          contactPhone: 'x'.repeat(80),
          representativeName: 'x'.repeat(120),
          representativeEmail: 'representative@example.com',
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    ['creditPolicyNote', 'x'.repeat(10_001)],
    ['contactPhone', 'x'.repeat(81)],
    ['representativeName', 'x'.repeat(121)],
    ['representativeEmail', 'not-an-email'],
  ])('rejects an invalid %s', (field, value) => {
    expect(
      supplierCreateSchema.safeParse({ body: { name: 'Supplier', [field]: value } }).success,
    ).toBe(false);
  });

  it('allows one ratio leg in PATCH because the service merges it with the existing record', () => {
    expect(supplierPatchSchema.safeParse({ body: { policyWriteOffQty: 4 } }).success).toBe(true);
  });

  it.each([supplierCreateSchema, supplierUpdateSchema])(
    'defers full-write ratio validation to the policy service',
    (schema) => {
      expect(schema.safeParse({ body: { name: 'Supplier', policyWriteOffQty: 4 } }).success).toBe(
        true,
      );
    },
  );

  it('leaves raw bulk cardinality for the service 422 boundary', () => {
    expect(
      bulkAttachPolicySchema.safeParse({
        body: { supplierId: 1, brandIds: Array.from({ length: 501 }, () => 1) },
      }).success,
    ).toBe(true);
    expect(bulkLinkProductsSchema.safeParse({ body: { brandId: 1, productIds: [] } }).success).toBe(
      true,
    );
  });

  it('requires exactly one bulk-link brand target', () => {
    expect(
      bulkLinkProductsSchema.safeParse({
        body: { brandId: 1, brandName: 'Both', productIds: [1] },
      }).success,
    ).toBe(false);
    expect(bulkLinkProductsSchema.safeParse({ body: { productIds: [1] } }).success).toBe(false);
  });
});
