import { SupplierCreditService } from '../../services/supplier-credit.service';
import { SupplierCreditRepository } from '../../repositories/supplier-credit.repository';
import { ConflictError, NotFoundError, ValidationError } from '../../errors';
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
  } = {},
) {
  const repo = {
    listSuppliers: vi.fn(async () => overrides.suppliers ?? []),
    findSupplier: vi.fn(async () => overrides.findSupplier ?? null),
    createSupplier: vi.fn(async (orgId: string, data) => ({
      id: 1,
      organizationId: orgId,
      ...data,
    })),
    updateSupplier: vi.fn(async () => overrides.updateCount ?? 1),
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
      await service.createSupplier({
        name: '  Blackmores  ',
        contactEmail: 'credits@blackmores.com.au',
        policyWriteOffQty: 3,
        policyCreditQty: 1,
      });
      expect(repo.createSupplier).toHaveBeenCalledWith('org-1', {
        name: 'Blackmores',
        contactEmail: 'credits@blackmores.com.au',
        creditPolicyNote: '',
        policyWriteOffQty: 3,
        policyCreditQty: 1,
        followUpDays: 7,
      });
    });

    it('rejects a half-specified credit ratio', async () => {
      const { service } = makeService();
      await expect(
        service.createSupplier({ name: 'Half', policyWriteOffQty: 3 }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('updateSupplier', () => {
    it('404s when the supplier is not in the org', async () => {
      const { service } = makeService({ updateCount: 0 });
      await expect(service.updateSupplier(99, { name: 'X' })).rejects.toBeInstanceOf(NotFoundError);
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
