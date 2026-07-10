import {
  CreditClaimService,
  PHOTO_RETENTION_DAYS,
} from '../../services/credit-claim.service';
import { CreditClaimRepository } from '../../repositories/credit-claim.repository';
import { SupplierCreditRepository } from '../../repositories/supplier-credit.repository';
import { NotFoundError, ValidationError } from '../../errors';
import type { EmailSender } from '../../services/email-sender';

const NOW = new Date('2026-07-10T00:00:00.000Z');

function makeDeps(overrides: {
  supplier?: unknown;
  writeOffs?: unknown[];
  claim?: unknown;
  emailAccepted?: boolean;
} = {}) {
  const supplier = overrides.supplier ?? {
    id: 10,
    contactEmail: 'credits@blackmores.com.au',
    name: 'Blackmores',
    policyWriteOffQty: 3,
    policyCreditQty: 1,
    followUpDays: 7,
  };

  const createClaim = vi.fn(async () => ({ id: 1 }));
  const createLine = vi.fn(async () => ({ id: 1 }));
  const addEvent = vi.fn(async () => ({ id: 1 }));
  const updateClaim = vi.fn(async () => 1);
  const setPhotoDeleteAfterForClaim = vi.fn(async () => undefined);
  const findClaim = vi.fn(async () => overrides.claim ?? null);

  const repo = {
    findWriteOffsByIds: vi.fn(async () => overrides.writeOffs ?? []),
    createClaim,
    createLine,
    addEvent,
    updateClaim,
    setPhotoDeleteAfterForClaim,
    findClaim,
  } as unknown as CreditClaimRepository;

  const supplierRepo = {
    findSupplier: vi.fn(async () => overrides.supplier ?? supplier),
  } as unknown as SupplierCreditRepository;

  const emailSender: EmailSender = {
    send: vi.fn(async () => overrides.emailAccepted ?? true),
  };

  const storage = {
    upload: vi.fn(async () => 'key'),
    download: vi.fn(async () => Buffer.from('img')),
    delete: vi.fn(),
    exists: vi.fn(),
  } as never;

  // Fake $transaction that runs the callback with a throwaway tx object.
  const prisma = { $transaction: async (fn: (tx: unknown) => unknown) => fn({}) } as never;

  const service = new CreditClaimService('org-1', {
    prismaClient: prisma,
    repo,
    supplierRepo,
    emailSender,
    storage,
    now: () => NOW,
  });

  return { service, repo, supplierRepo, emailSender, createClaim, createLine, updateClaim, addEvent, setPhotoDeleteAfterForClaim };
}

const writeOff = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  action: 'expired',
  creditClaimLine: null,
  unitsDiscarded: 6,
  inventoryItem: {
    product: { id: 100, supplierId: 10, sku: 'BM-1', name: 'Vitamin D', costPrice: 10 },
  },
  ...overrides,
});

describe('CreditClaimService', () => {
  describe('buildClaim', () => {
    it('snapshots expected credit per line and in aggregate', async () => {
      const built = { id: 1, lines: [], events: [], supplier: {} };
      const { service, repo, createClaim, createLine } = makeDeps({
        writeOffs: [writeOff()],
        claim: built,
      });
      (repo.findClaim as ReturnType<typeof vi.fn>).mockResolvedValue(built);

      await service.buildClaim(
        { supplierId: 10, lines: [{ expiredItemTransactionId: 1, batchNumber: 'L1', unitsClaimed: 6 }] },
        7,
      );

      expect(createClaim).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ expectedCreditUnits: 2, expectedCreditValue: 20 }),
        expect.anything(),
      );
      expect(createLine).toHaveBeenCalledWith(
        'org-1',
        1,
        expect.objectContaining({ unitsClaimed: 6, expectedCreditUnits: 2, expectedCreditValue: 20, batchNumber: 'L1' }),
        expect.anything(),
      );
    });

    it('404s for an unknown supplier', async () => {
      const { service } = makeDeps({ supplier: null });
      await expect(
        service.buildClaim({ supplierId: 99, lines: [{ expiredItemTransactionId: 1 }] }, null),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejects a write-off already on a claim', async () => {
      const { service } = makeDeps({ writeOffs: [writeOff({ creditClaimLine: { id: 5 } })] });
      await expect(
        service.buildClaim({ supplierId: 10, lines: [{ expiredItemTransactionId: 1 }] }, null),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects a write-off whose product is not assigned to this supplier', async () => {
      const { service } = makeDeps({
        writeOffs: [writeOff({ inventoryItem: { product: { id: 100, supplierId: 20, costPrice: 10, sku: 'x', name: 'y' } } })],
      });
      await expect(
        service.buildClaim({ supplierId: 10, lines: [{ expiredItemTransactionId: 1 }] }, null),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('sendClaim', () => {
    const draft = {
      id: 1,
      status: 'DRAFT',
      contactEmailSnapshot: 'credits@blackmores.com.au',
      lines: [{ id: 1, batchNumber: 'L1', unitsClaimed: 6, expectedCreditValue: 20, photos: [] }],
      supplier: { name: 'Blackmores', contactEmail: 'credits@blackmores.com.au', followUpDays: 7 },
      followUpCount: 0,
      sentAt: null,
      expectedCreditValue: 20,
    };

    it('sends, sets a verified sentAt and schedules the first follow-up', async () => {
      const { service, repo, emailSender, updateClaim, addEvent } = makeDeps({ claim: draft });
      await service.sendClaim(1);

      expect(emailSender.send).toHaveBeenCalledOnce();
      expect(updateClaim).toHaveBeenCalledWith(
        'org-1',
        1,
        expect.objectContaining({
          status: 'SENT',
          sentAt: NOW,
          nextFollowUpAt: new Date('2026-07-17T00:00:00.000Z'),
        }),
      );
      expect(addEvent).toHaveBeenCalledWith('org-1', 1, 'SENT', null, expect.any(String));
      expect(repo.findClaim).toHaveBeenCalled();
    });

    it('refuses to send without a supplier contact email', async () => {
      const noEmail = { ...draft, contactEmailSnapshot: null, supplier: { ...draft.supplier, contactEmail: null } };
      const { service } = makeDeps({ claim: noEmail });
      await expect(service.sendClaim(1)).rejects.toBeInstanceOf(ValidationError);
    });

    it('does not mark sent when the provider rejects the message', async () => {
      const { service, updateClaim } = makeDeps({ claim: draft, emailAccepted: false });
      await expect(service.sendClaim(1)).rejects.toBeInstanceOf(ValidationError);
      expect(updateClaim).not.toHaveBeenCalled();
    });
  });

  describe('recordOutcome', () => {
    const sent = {
      id: 1,
      status: 'SENT',
      lines: [{ id: 1, photos: [] }],
      supplier: { name: 'Blackmores', followUpDays: 7 },
    };

    it('settles the claim and schedules photo deletion after the retention window', async () => {
      const { service, updateClaim, setPhotoDeleteAfterForClaim, addEvent } = makeDeps({ claim: sent });
      await service.recordOutcome(1, 'CREDITED', 20, 'received');

      expect(updateClaim).toHaveBeenCalledWith(
        'org-1',
        1,
        expect.objectContaining({ status: 'CREDITED', creditedValue: 20, settledAt: NOW, nextFollowUpAt: null }),
        expect.anything(),
      );
      const expectedDeleteAfter = new Date(NOW.getTime() + PHOTO_RETENTION_DAYS * 86400000);
      expect(setPhotoDeleteAfterForClaim).toHaveBeenCalledWith('org-1', 1, expectedDeleteAfter, expect.anything());
      expect(addEvent).toHaveBeenCalledWith('org-1', 1, 'CREDITED', null, 'received', expect.anything());
    });

    it('nulls credited value on rejection', async () => {
      const { service, updateClaim } = makeDeps({ claim: sent });
      await service.recordOutcome(1, 'REJECTED', 20, null);
      expect(updateClaim).toHaveBeenCalledWith(
        'org-1',
        1,
        expect.objectContaining({ status: 'REJECTED', creditedValue: null }),
        expect.anything(),
      );
    });

    it('refuses to record an outcome for a draft claim', async () => {
      const { service } = makeDeps({ claim: { ...sent, status: 'DRAFT' } });
      await expect(service.recordOutcome(1, 'CREDITED', 20, null)).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('sendFollowUp', () => {
    it('advances the follow-up count and schedule from the send date', async () => {
      const claim = {
        id: 1,
        status: 'SENT',
        contactEmailSnapshot: 'credits@blackmores.com.au',
        sentAt: new Date('2026-07-10T00:00:00.000Z'),
        followUpCount: 0,
        lines: [{ id: 1, photos: [] }],
        supplier: { name: 'Blackmores', contactEmail: 'credits@blackmores.com.au', followUpDays: 7 },
      };
      const { service, updateClaim, addEvent } = makeDeps({ claim });
      await service.sendFollowUp(1);

      expect(updateClaim).toHaveBeenCalledWith(
        'org-1',
        1,
        expect.objectContaining({
          followUpCount: 1,
          nextFollowUpAt: new Date('2026-07-24T00:00:00.000Z'),
        }),
      );
      expect(addEvent).toHaveBeenCalledWith('org-1', 1, 'FOLLOW_UP_SENT', null, null);
    });
  });
});
