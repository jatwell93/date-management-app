import { SupplierCreditService } from '../../services/supplier-credit.service';
import { SupplierCreditRepository } from '../../repositories/supplier-credit.repository';
import { NotFoundError, ValidationError } from '../../errors';
import type { ClaimableWriteOffRow } from '../../../../shared/domain/credit-claim';

function makeService(
  overrides: {
    suppliers?: unknown[];
    findSupplier?: unknown;
    updateCount?: number;
    assignCount?: number;
    claimable?: ClaimableWriteOffRow[];
  } = {},
) {
  const repo = {
    listSuppliers: vi.fn(async () => overrides.suppliers ?? []),
    findSupplier: vi.fn(async () => overrides.findSupplier ?? null),
    createSupplier: vi.fn(async (orgId: string, data) => ({ id: 1, organizationId: orgId, ...data })),
    updateSupplier: vi.fn(async () => overrides.updateCount ?? 1),
    assignProductSupplier: vi.fn(async () => overrides.assignCount ?? 1),
    findClaimableWriteOffs: vi.fn(async () => overrides.claimable ?? []),
  } as unknown as SupplierCreditRepository;

  const service = new SupplierCreditService('org-1', {} as never, repo);
  return { service, repo };
}

describe('SupplierCreditService', () => {
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
});
