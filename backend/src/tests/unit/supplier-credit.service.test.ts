import { SupplierCreditService } from '../../services/supplier-credit.service';
import { SupplierCreditRepository } from '../../repositories/supplier-credit.repository';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  PolicyValidationError,
  ValidationError,
} from '../../errors';
import type { ClaimableWriteOffRow } from '../../../../shared/domain/credit-claim';
import { isPlatformAdminUser } from '../../controllers/supplier-credit.controller';

function makeService(
  overrides: {
    suppliers?: unknown[];
    findSupplier?: unknown;
    updateCount?: number;
    assignCount?: number;
    claimable?: ClaimableWriteOffRow[];
    disposeResult?: 'DISPOSED' | 'ALREADY_DISPOSED' | 'CLAIMED' | 'NOT_FOUND';
    brandResult?: unknown;
    correctionUpdateResult?: 'UPDATED' | 'ALREADY_REVIEWED' | 'NOT_FOUND';
    existingSupplier?: Record<string, unknown> | null;
  } = {},
) {
  const existingSupplier =
    overrides.existingSupplier === undefined
      ? {
          id: 1,
          organizationId: 'org-1',
          name: 'Existing',
          contactEmail: 'claims@example.com',
          contactPhone: null,
          creditPolicyNote: 'Keep chilled',
          policyWriteOffQty: 3,
          policyCreditQty: 1,
          followUpDays: 7,
          representativeName: 'Alex',
          representativeEmail: 'alex@example.com',
          policyUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        }
      : overrides.existingSupplier;
  const repo = {
    withTransaction: vi.fn(async (callback) => callback(undefined)),
    listSuppliers: vi.fn(async () => overrides.suppliers ?? []),
    findSupplier: vi.fn(async () =>
      overrides.findSupplier === undefined ? existingSupplier : overrides.findSupplier,
    ),
    createSupplier: vi.fn(async (orgId: string, data) => ({
      id: 1,
      organizationId: orgId,
      ...data,
    })),
    updateSupplier: vi.fn(async () => overrides.updateCount ?? 1),
    clearSupplierPolicy: vi.fn(async () => existingSupplier),
    listPolicyReview: vi.fn(async () => []),
    bulkAttachSupplier: vi.fn(async () => ({ attached: 2, unchanged: 0, corrections: 2 })),
    bulkLinkProducts: vi.fn(async () => ({
      brandId: 8,
      linked: 2,
      alreadyLinked: 0,
      corrections: 2,
    })),
    assignProductSupplier: vi.fn(async () => overrides.assignCount ?? 1),
    findClaimableWriteOffs: vi.fn(async () => overrides.claimable ?? []),
    disposeWriteOff: vi.fn(async () => overrides.disposeResult ?? 'DISPOSED'),
    listBrands: vi.fn(async () => []),
    reviewBrands: vi.fn(async () => ({ items: [], nextCursor: null })),
    addBrandForProduct: vi.fn(async () => overrides.brandResult ?? { id: 30 }),
    confirmBrandSupplier: vi.fn(async () => overrides.updateCount ?? 1),
    findBrand: vi.fn(async () => overrides.brandResult ?? { id: 30, source: 'CONFIRMED' }),
    listCatalogueCorrections: vi.fn(async () => ({ items: [], nextCursor: null })),
    updateCatalogueCorrectionStatus: vi.fn(
      async () => overrides.correctionUpdateResult ?? 'UPDATED',
    ),
  } as unknown as SupplierCreditRepository;

  const service = new SupplierCreditService('org-1', {} as never, repo);
  return { service, repo };
}

describe('SupplierCreditService', () => {
  describe('platform admin authorization', () => {
    it('accepts only numeric IDs in a fully valid comma-separated allowlist', () => {
      expect(isPlatformAdminUser(7, '2, 7, 12')).toBe(true);
      expect(isPlatformAdminUser(8, '2, 7, 12')).toBe(false);
    });

    it.each([undefined, '', '7,not-a-number', '7,,12', '0,7'])(
      'fails closed for malformed configuration %s',
      (configuration) => {
        expect(isPlatformAdminUser(7, configuration)).toBe(false);
      },
    );
  });
  describe('createSupplier', () => {
    it('persists a supplier with a complete credit ratio', async () => {
      const { service, repo } = makeService();
      await service.createSupplier(
        {
          name: '  Blackmores  ',
          contactEmail: 'credits@blackmores.com.au',
          policyWriteOffQty: 3,
          policyCreditQty: 1,
          creditPolicyNote: 'Return with invoice',
        },
        'admin',
      );
      expect(repo.createSupplier).toHaveBeenCalledWith(
        'org-1',
        {
          name: 'Blackmores',
          contactEmail: 'credits@blackmores.com.au',
          contactPhone: null,
          creditPolicyNote: 'Return with invoice',
          policyWriteOffQty: 3,
          policyCreditQty: 1,
          followUpDays: 7,
          representativeName: null,
          representativeEmail: null,
          policyUpdatedAt: expect.any(Date),
        },
        undefined,
      );
    });

    it('rejects a half-specified credit ratio', async () => {
      const { service } = makeService();
      await expect(
        service.createSupplier({ name: 'Half', policyWriteOffQty: 3 }, 'admin'),
      ).rejects.toBeInstanceOf(PolicyValidationError);
    });

    it('allows a team member to create a bare supplier with claim contact details', async () => {
      const { service, repo } = makeService();

      await service.createSupplier(
        { name: 'Bare Supplier', contactEmail: 'claims@example.com', contactPhone: '02 1234 5678' },
        'team_member',
      );

      expect(repo.createSupplier).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ creditPolicyNote: '', policyUpdatedAt: null }),
        undefined,
      );
    });

    it('rejects changed policy content from a non-admin', async () => {
      const { service } = makeService();
      await expect(
        service.createSupplier(
          { name: 'Policy Supplier', creditPolicyNote: 'Return monthly', contactPhone: '555' },
          'manager',
        ),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it('returns structured policy validation failures for admins', async () => {
      const { service } = makeService();
      await expect(
        service.createSupplier({ name: 'Invalid', creditPolicyNote: 'Return monthly' }, 'admin'),
      ).rejects.toMatchObject<Partial<PolicyValidationError>>({
        statusCode: 422,
        code: 'POLICY_VALIDATION_ERROR',
        errors: [{ field: 'contact', message: expect.any(String) }],
      });
    });
  });

  describe('updateSupplier', () => {
    it('404s when the supplier is not in the org', async () => {
      const { service } = makeService({ updateCount: 0 });
      await expect(service.updateSupplier(99, { name: 'X' }, 'admin')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('merges partial input and permits contact-only changes without a policy timestamp bump', async () => {
      const { service, repo } = makeService();

      await service.updateSupplier(1, { contactPhone: '  02 9999 8888  ' }, 'team_member');

      expect(repo.updateSupplier).toHaveBeenCalledWith(
        'org-1',
        1,
        expect.objectContaining({
          name: 'Existing',
          contactPhone: '02 9999 8888',
          creditPolicyNote: 'Keep chilled',
          policyUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
        undefined,
      );
    });

    it('treats normalized unchanged policy as an ordinary non-admin update', async () => {
      const { service, repo } = makeService();

      await service.updateSupplier(1, { creditPolicyNote: '  Keep chilled  ' }, 'team_member');

      expect(repo.updateSupplier).toHaveBeenCalledWith(
        'org-1',
        1,
        expect.objectContaining({ policyUpdatedAt: new Date('2026-01-01T00:00:00.000Z') }),
        undefined,
      );
    });

    it('stamps the policy timestamp when an admin changes effective policy content', async () => {
      const { service, repo } = makeService();

      await service.updateSupplier(1, { creditPolicyNote: 'Return monthly' }, 'admin');

      expect(repo.updateSupplier).toHaveBeenCalledWith(
        'org-1',
        1,
        expect.objectContaining({
          creditPolicyNote: 'Return monthly',
          policyUpdatedAt: expect.any(Date),
        }),
        undefined,
      );
    });

    it('clears policy only for admins while preserving supplier contact fields', async () => {
      const { service, repo } = makeService();

      await service.clearSupplierPolicy(1, 'admin');

      expect(repo.clearSupplierPolicy).toHaveBeenCalledWith(
        'org-1',
        1,
        expect.any(Date),
        undefined,
      );
      await expect(service.clearSupplierPolicy(1, 'team_member')).rejects.toBeInstanceOf(
        AuthorizationError,
      );
    });

    it('preserves legacy full PUT replacement semantics separately from PATCH merging', async () => {
      const { service, repo } = makeService();

      await service.replaceSupplier(
        1,
        {
          name: 'Replacement',
          contactEmail: 'new@example.com',
          creditPolicyNote: 'Return monthly',
        },
        'admin',
      );

      expect(repo.updateSupplier).toHaveBeenCalledWith(
        'org-1',
        1,
        expect.objectContaining({
          name: 'Replacement',
          contactEmail: 'new@example.com',
          contactPhone: null,
          policyWriteOffQty: null,
          policyCreditQty: null,
          followUpDays: 7,
          representativeName: null,
          representativeEmail: null,
        }),
        undefined,
      );
    });

    it('authorizes a non-admin full replacement before validating its credit ratio', async () => {
      const { service } = makeService();

      await expect(
        service.replaceSupplier(
          1,
          {
            name: 'Replacement',
            contactPhone: '02 1234 5678',
            creditPolicyNote: 'Return monthly',
            policyWriteOffQty: 3,
          },
          'team_member',
        ),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });
  });

  describe('assignProductSupplier', () => {
    it('404s when assigning a supplier that is not in the org', async () => {
      const { service } = makeService({ findSupplier: null });
      await expect(service.assignProductSupplier(5, 42)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('clears a product supplier without a supplier lookup', async () => {
      const { service, repo } = makeService();
      await service.assignProductSupplier(5, null);
      expect(repo.findSupplier).not.toHaveBeenCalled();
      expect(repo.assignProductSupplier).toHaveBeenCalledWith('org-1', 5, null);
    });

    it('404s when the product is not in the org', async () => {
      const { service } = makeService({ findSupplier: { id: 42 }, assignCount: 0 });
      await expect(service.assignProductSupplier(5, 42)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('passes the authenticated user through for transactional correction capture', async () => {
      const { service, repo } = makeService({ findSupplier: { id: 42 } });
      await service.assignProductSupplier(5, 42, 7);
      expect(repo.assignProductSupplier).toHaveBeenCalledWith('org-1', 5, 42, 7);
    });
  });

  describe('brands and review', () => {
    it('lists and reviews only through the service organization scope', async () => {
      const { service, repo } = makeService();
      await service.listBrands();
      await service.reviewBrands({
        state: 'NEEDS_BRAND',
        group: 'Unmatched',
        cursor: 20,
        limit: 10,
      });
      expect(repo.listBrands).toHaveBeenCalledWith('org-1');
      expect(repo.reviewBrands).toHaveBeenCalledWith('org-1', {
        state: 'NEEDS_BRAND',
        group: 'Unmatched',
        cursor: 20,
        limit: 10,
      });
    });

    it('adds a user-confirmed brand and correction through one repository operation', async () => {
      const { service, repo } = makeService({ findSupplier: { id: 42 } });
      await service.addBrand({ productId: 5, name: ' New Brand ', supplierId: 42 }, 7);
      expect(repo.addBrandForProduct).toHaveBeenCalledWith(
        'org-1',
        { productId: 5, name: 'New Brand', supplierId: 42 },
        7,
      );
    });

    it('confirms only an organization-owned supplier for a brand', async () => {
      const { service } = makeService({ findSupplier: null });
      await expect(service.confirmBrandSupplier(30, 99)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('marks an organization-owned brand confirmed', async () => {
      const { service, repo } = makeService({ findSupplier: { id: 42 } });
      await service.confirmBrandSupplier(30, 42);
      expect(repo.confirmBrandSupplier).toHaveBeenCalledWith('org-1', 30, 42);
    });

    it('uses CONFIRMED for catalogue setup rather than claimability', async () => {
      const { service, repo } = makeService();

      await service.reviewBrands({ state: 'CONFIRMED' });

      expect(repo.reviewBrands).toHaveBeenCalledWith('org-1', {
        state: 'CONFIRMED',
        limit: 50,
      });
    });

    it('rejects claimability states as catalogue-review filters', async () => {
      const { service, repo } = makeService();

      expect(() => service.reviewBrands({ state: 'CLAIMABLE' })).toThrow(ValidationError);
      expect(repo.reviewBrands).not.toHaveBeenCalled();
    });
  });

  describe('policy review and bulk operations', () => {
    it('passes org-scoped policy review filters to the repository', async () => {
      const { service, repo } = makeService();

      await service.listPolicyReview({ brand: 'vita', supplier: 'maker', status: 'MISSING' });

      expect(repo.listPolicyReview).toHaveBeenCalledWith('org-1', {
        brand: 'vita',
        supplier: 'maker',
        status: 'MISSING',
      });
    });

    it('deduplicates brand IDs after enforcing the raw cap and requires an admin', async () => {
      const { service, repo } = makeService();

      await service.bulkAttachPolicy({ supplierId: 4, brandIds: [10, 10, 11] }, 'org:admin', 7);

      expect(repo.bulkAttachSupplier).toHaveBeenCalledWith('org-1', 4, [10, 11], 7, undefined);
      await expect(
        service.bulkAttachPolicy({ supplierId: 4, brandIds: [10] }, 'team_member', 7),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it('rejects 501 raw IDs even when they are duplicates', async () => {
      const { service, repo } = makeService();
      await expect(
        service.bulkAttachPolicy(
          { supplierId: 4, brandIds: Array.from({ length: 501 }, () => 10) },
          'admin',
          7,
        ),
      ).rejects.toBeInstanceOf(PolicyValidationError);
      expect(repo.bulkAttachSupplier).not.toHaveBeenCalled();
    });

    it('deduplicates products and accepts exactly one brand target', async () => {
      const { service, repo } = makeService();

      await service.bulkLinkProducts({ brandName: '  New Brand  ', productIds: [1, 1, 2] }, 7);

      expect(repo.bulkLinkProducts).toHaveBeenCalledWith(
        'org-1',
        { brandId: undefined, brandName: 'New Brand' },
        [1, 2],
        7,
        undefined,
      );
      await expect(
        service.bulkLinkProducts({ brandId: 2, brandName: 'Both', productIds: [1] }, 7),
      ).rejects.toBeInstanceOf(PolicyValidationError);
    });

    it.each([0, -1, 1.5])(
      'rejects invalid brand ID %s in the service boundary',
      async (brandId) => {
        const { service, repo } = makeService();
        await expect(
          service.bulkLinkProducts({ brandId, productIds: [1] }, 7),
        ).rejects.toBeInstanceOf(PolicyValidationError);
        expect(repo.bulkLinkProducts).not.toHaveBeenCalled();
      },
    );
  });

  describe('platform correction review', () => {
    it('uses stable cursor pagination for pending corrections', async () => {
      const { service, repo } = makeService();
      await service.listCatalogueCorrections({ status: 'PENDING', cursor: 12, limit: 25 });
      expect(repo.listCatalogueCorrections).toHaveBeenCalledWith({
        status: 'PENDING',
        cursor: 12,
        limit: 25,
      });
    });

    it('only accepts terminal review statuses', async () => {
      const { service } = makeService();
      await expect(
        service.reviewCatalogueCorrection(1, 'PENDING' as 'ACCEPTED'),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('404s a missing correction without mutating other records', async () => {
      const { service } = makeService({ correctionUpdateResult: 'NOT_FOUND' });
      await expect(service.reviewCatalogueCorrection(1, 'ACCEPTED')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('conflicts when a correction already has a terminal decision', async () => {
      const { service } = makeService({ correctionUpdateResult: 'ALREADY_REVIEWED' });

      await expect(service.reviewCatalogueCorrection(1, 'REJECTED')).rejects.toBeInstanceOf(
        ConflictError,
      );
    });
  });

  describe('getClaimablePool', () => {
    it('groups claimable write-offs by supplier via the shared rollup', async () => {
      const { service } = makeService({
        claimable: [
          {
            transactionId: 1,
            supplierId: 10,
            supplierName: 'Blackmores',
            policyWriteOffQty: 3,
            policyCreditQty: 1,
            productId: 100,
            sku: 'BM-1',
            productName: 'Vitamin D',
            unitsDiscarded: 6,
            costPrice: 10,
          },
          {
            transactionId: 2,
            supplierId: null,
            supplierName: null,
            policyWriteOffQty: null,
            policyCreditQty: null,
            productId: 200,
            sku: 'X-1',
            productName: 'Mystery',
            unitsDiscarded: 2,
            costPrice: 5,
          },
        ],
      });

      const groups = await service.getClaimablePool();
      expect(groups).toHaveLength(2);
      expect(groups[0].supplierName).toBe('Blackmores');
      expect(groups[0].expectedCreditValueTotal).toBe(20);
      expect(groups[1].supplierId).toBeNull();
    });
  });

  describe('disposeWriteOff', () => {
    it('is idempotent for an already disposed transaction', async () => {
      const { service } = makeService({ disposeResult: 'ALREADY_DISPOSED' });
      await expect(service.disposeWriteOff(12)).resolves.toEqual({
        transactionId: 12,
        creditDisposition: 'DISPOSED',
      });
    });

    it('conflicts after the transaction enters a claim', async () => {
      const { service } = makeService({ disposeResult: 'CLAIMED' });
      await expect(service.disposeWriteOff(12)).rejects.toBeInstanceOf(ConflictError);
    });

    it('does not disclose a transaction outside the organization', async () => {
      const { service } = makeService({ disposeResult: 'NOT_FOUND' });
      await expect(service.disposeWriteOff(12)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
