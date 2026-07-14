import {
  expectedCredit,
  nextFollowUp,
  isFollowUpDue,
  isSettledClaimStatus,
  isChaseableClaimStatus,
  rollupClaimablePool,
  rollupRecoveryReport,
  type ClaimableWriteOffRow,
  type RecoveryClaimRow,
} from '../../../../shared/domain/credit-claim';

describe('credit-claim shared domain', () => {
  describe('expectedCredit', () => {
    it('yields 2 units for 6 written off at a 3-for-1 ratio', () => {
      // Spec scenario: A supplier with a 3-for-1 ratio yields expected credit.
      const result = expectedCredit({ writeOffQty: 3, creditQty: 1 }, 6, 10);
      expect(result).toEqual({ units: 2, value: 20 });
    });

    it('yields 0 units below the write-off threshold', () => {
      // The magnesium case: 1 unit under a 3-for-1 policy earns nothing.
      expect(expectedCredit({ writeOffQty: 3, creditQty: 1 }, 1, 10)).toEqual({
        units: 0,
        value: 0,
      });
    });

    it('returns unknown (null) when the supplier has no structured ratio', () => {
      // Spec scenario: A supplier without a structured ratio has unknown expected credit.
      expect(expectedCredit({ writeOffQty: null, creditQty: null }, 6, 10)).toEqual({
        units: null,
        value: null,
      });
    });

    it('returns unknown value when unit cost is not provided', () => {
      expect(expectedCredit({ writeOffQty: 3, creditQty: 1 }, 6)).toEqual({
        units: 2,
        value: null,
      });
    });

    it('treats a zero write-off quantity as unknown rather than dividing by zero', () => {
      expect(expectedCredit({ writeOffQty: 0, creditQty: 1 }, 6, 10)).toEqual({
        units: null,
        value: null,
      });
    });
  });

  describe('status helpers', () => {
    it('classifies settled statuses', () => {
      expect(isSettledClaimStatus('CREDITED')).toBe(true);
      expect(isSettledClaimStatus('REJECTED')).toBe(true);
      expect(isSettledClaimStatus('CANCELLED')).toBe(true);
      expect(isSettledClaimStatus('SENT')).toBe(false);
    });

    it('classifies chaseable statuses', () => {
      expect(isChaseableClaimStatus('SENT')).toBe(true);
      expect(isChaseableClaimStatus('ACKNOWLEDGED')).toBe(true);
      expect(isChaseableClaimStatus('DRAFT')).toBe(false);
      expect(isChaseableClaimStatus('SENDING')).toBe(false);
      expect(isChaseableClaimStatus('CREDITED')).toBe(false);
    });
  });

  describe('nextFollowUp', () => {
    const sentAt = new Date('2026-07-10T00:00:00.000Z');

    it('schedules the first nudge one cadence after sending', () => {
      expect(nextFollowUp(sentAt, 7, 0)).toEqual(new Date('2026-07-17T00:00:00.000Z'));
    });

    it('advances by the cadence after each follow-up', () => {
      // Spec scenario: Following up advances the schedule.
      expect(nextFollowUp(sentAt, 7, 1)).toEqual(new Date('2026-07-24T00:00:00.000Z'));
      expect(nextFollowUp(sentAt, 7, 2)).toEqual(new Date('2026-07-31T00:00:00.000Z'));
    });
  });

  describe('isFollowUpDue', () => {
    const now = new Date('2026-07-20T00:00:00.000Z');

    it('is due for an open claim whose follow-up time has passed', () => {
      // Spec scenario: An overdue sent claim is surfaced for follow-up.
      expect(
        isFollowUpDue(
          { status: 'SENT', nextFollowUpAt: new Date('2026-07-17T00:00:00.000Z') },
          now,
        ),
      ).toBe(true);
    });

    it('is not due when the follow-up time is still in the future', () => {
      expect(
        isFollowUpDue(
          { status: 'SENT', nextFollowUpAt: new Date('2026-07-25T00:00:00.000Z') },
          now,
        ),
      ).toBe(false);
    });

    it('never chases a settled claim', () => {
      // Spec scenario: A settled claim is no longer chased.
      expect(
        isFollowUpDue(
          { status: 'CREDITED', nextFollowUpAt: new Date('2026-07-01T00:00:00.000Z') },
          now,
        ),
      ).toBe(false);
    });
  });

  describe('rollupClaimablePool', () => {
    const row = (overrides: Partial<ClaimableWriteOffRow> = {}): ClaimableWriteOffRow => ({
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
      ...overrides,
    });

    it('groups by supplier and totals known expected values', () => {
      const groups = rollupClaimablePool([
        row({ transactionId: 1, unitsDiscarded: 6 }),
        row({ transactionId: 2, sku: 'BM-2', productName: 'Fish Oil', unitsDiscarded: 3 }),
      ]);

      expect(groups).toHaveLength(1);
      expect(groups[0].supplierName).toBe('Blackmores');
      expect(groups[0].items).toHaveLength(2);
      // 2 units * $10 + 1 unit * $10 = $30
      expect(groups[0].expectedCreditValueTotal).toBe(30);
    });

    it('collects supplier-less write-offs into a needs-supplier bucket, sorted last', () => {
      // Spec scenario: An unassigned product appears as needs-supplier.
      const groups = rollupClaimablePool([
        row({
          transactionId: 1,
          supplierId: null,
          supplierName: null,
          policyWriteOffQty: null,
          policyCreditQty: null,
        }),
        row({ transactionId: 2 }),
      ]);

      expect(groups).toHaveLength(2);
      expect(groups[0].supplierName).toBe('Blackmores');
      expect(groups[1].supplierId).toBeNull();
      expect(groups[1].items[0].expectedCreditUnits).toBeNull();
    });

    it('orders real suppliers by name for cross-backend determinism', () => {
      const groups = rollupClaimablePool([
        row({ transactionId: 1, supplierId: 20, supplierName: 'Nature’s Own' }),
        row({ transactionId: 2, supplierId: 10, supplierName: 'Blackmores' }),
      ]);

      expect(groups.map((g) => g.supplierName)).toEqual(['Blackmores', 'Nature’s Own']);
    });

    it('groups catalogue suggestions by suggested supplier in pending confirmation', () => {
      const groups = rollupClaimablePool([
        row({
          transactionId: 1,
          supplierId: null,
          supplierName: null,
          policyWriteOffQty: null,
          policyCreditQty: null,
          brandId: 1,
          brandName: 'Blackmores',
          brandSource: 'REFERENCE',
          suggestedSupplierName: ' Blackmores Group ',
        }),
        row({
          transactionId: 2,
          supplierId: null,
          supplierName: null,
          policyWriteOffQty: null,
          policyCreditQty: null,
          brandId: 2,
          brandName: 'BioCeuticals',
          brandSource: 'REFERENCE',
          suggestedSupplierName: 'Blackmores Group',
        }),
      ]);

      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({
        supplierId: null,
        supplierName: 'Blackmores Group',
        state: 'PENDING_CONFIRMATION',
      });
      expect(groups[0].items.map((item) => item.brandName)).toEqual(['Blackmores', 'BioCeuticals']);
    });

    it('classifies confirmed suppliers with and without policy', () => {
      const groups = rollupClaimablePool([
        row({ transactionId: 1, policyWriteOffQty: null, policyCreditQty: null }),
        row({ transactionId: 2, supplierId: 20, supplierName: 'With Policy' }),
      ]);

      expect(groups.find((group) => group.supplierId === 10)?.state).toBe('NO_POLICY');
      expect(groups.find((group) => group.supplierId === 20)?.state).toBe('CLAIMABLE');
    });

    it('keeps the product override ahead of a different confirmed brand supplier', () => {
      const groups = rollupClaimablePool([
        row({
          supplierId: 10,
          supplierName: 'Override Supplier',
          brandId: 1,
          brandName: 'Brand',
          brandSource: 'CONFIRMED',
          brandSupplierId: 20,
          brandSupplierName: 'Brand Supplier',
        }),
      ]);
      expect(groups[0].supplierName).toBe('Override Supplier');
    });
  });

  describe('rollupRecoveryReport', () => {
    const claim = (overrides: Partial<RecoveryClaimRow> = {}): RecoveryClaimRow => ({
      supplierId: 10,
      supplierName: 'Blackmores',
      status: 'SENT',
      expectedCreditValue: 100,
      creditedValue: null,
      ...overrides,
    });

    it('sums outstanding value from chaseable claims only', () => {
      const report = rollupRecoveryReport(
        [
          claim({ status: 'SENT', expectedCreditValue: 100 }),
          claim({ status: 'ACKNOWLEDGED', expectedCreditValue: 50 }),
          claim({ status: 'CREDITED', expectedCreditValue: 30, creditedValue: 30 }),
        ],
        200,
      );
      expect(report.outstandingValue).toBe(150);
      expect(report.unclaimedValue).toBe(200);
    });

    it('computes per-supplier recovery rate as credited over expected', () => {
      const report = rollupRecoveryReport(
        [
          claim({ status: 'CREDITED', expectedCreditValue: 100, creditedValue: 80 }),
          claim({ status: 'SENT', expectedCreditValue: 100 }),
        ],
        0,
      );
      const blackmores = report.suppliers[0];
      expect(blackmores.claimsSent).toBe(2);
      expect(blackmores.claimsCredited).toBe(1);
      expect(blackmores.expectedValue).toBe(200);
      expect(blackmores.creditedValue).toBe(80);
      expect(blackmores.recoveryRate).toBe(0.4);
    });
  });
});
