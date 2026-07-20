import {
  brandPolicyStatus,
  hasPolicy,
  isPolicyWrite,
  validatePolicyWrite,
  type SupplierPolicyRecord,
} from '../../../../shared/domain/supplier-policy';

const baseline: SupplierPolicyRecord = {
  creditPolicyNote: '',
  policyWriteOffQty: null,
  policyCreditQty: null,
  followUpDays: 7,
  representativeName: null,
  representativeEmail: null,
  contactEmail: null,
  contactPhone: null,
};

describe('supplier-policy shared domain', () => {
  describe('policy status', () => {
    it.each([
      [{ creditPolicyNote: 'Return damaged stock' }, true],
      [{ creditPolicyNote: '  \n  ' }, false],
      [{ creditPolicyNote: null }, false],
      [null, false],
    ] as const)('detects whether instructions constitute a policy', (supplier, expected) => {
      expect(hasPolicy(supplier)).toBe(expected);
    });

    it('maps a resolved supplier to the brand policy status', () => {
      expect(brandPolicyStatus({}, { creditPolicyNote: 'Credit monthly' })).toBe('ATTACHED');
      expect(brandPolicyStatus({}, { creditPolicyNote: '  ' })).toBe('MISSING');
      expect(brandPolicyStatus({}, null)).toBe('MISSING');
    });
  });

  describe('policy write detection', () => {
    it('uses bare supplier defaults as the create baseline', () => {
      expect(isPolicyWrite({ name: 'New Supplier' }, null)).toBe(false);
      expect(isPolicyWrite({ name: 'New Supplier', followUpDays: 7 }, null)).toBe(false);
      expect(
        isPolicyWrite({ name: 'New Supplier', creditPolicyNote: 'Returns weekly' }, null),
      ).toBe(true);
    });

    it('compares normalized effective records instead of raw field presence', () => {
      const existing = {
        ...baseline,
        creditPolicyNote: '  Return monthly  ',
        representativeName: '  Alex  ',
      };

      expect(
        isPolicyWrite({ creditPolicyNote: 'Return monthly', representativeName: 'Alex' }, existing),
      ).toBe(false);
      expect(isPolicyWrite({ creditPolicyNote: 'Return weekly' }, existing)).toBe(true);
    });

    it('does not gate contact-only changes but treats explicit policy clearing as a write', () => {
      const existing = { ...baseline, creditPolicyNote: 'Return monthly', contactPhone: '02 1234' };

      expect(isPolicyWrite({ contactPhone: '02 9999' }, existing)).toBe(false);
      expect(isPolicyWrite({ contactEmail: 'claims@example.com' }, existing)).toBe(false);
      expect(isPolicyWrite({ creditPolicyNote: null }, existing)).toBe(true);
    });
  });

  describe('policy validation', () => {
    it.each([
      ['claim email', { contactEmail: 'claims@example.com' }],
      ['phone', { contactPhone: '+61 (0)2 1234 5678' }],
      ['representative email', { representativeEmail: 'rep@example.com' }],
    ])('accepts instructions with a %s', (_label, contact) => {
      expect(
        validatePolicyWrite({ creditPolicyNote: 'Return monthly', ...contact }, baseline),
      ).toEqual([]);
    });

    it('uses existing contact values when validating a partial edit', () => {
      expect(
        validatePolicyWrite(
          { creditPolicyNote: 'Return weekly' },
          { ...baseline, contactPhone: '02 1234' },
        ),
      ).toEqual([]);
    });

    it('returns field errors for missing instructions and missing contact', () => {
      expect(validatePolicyWrite({ policyWriteOffQty: 3 }, baseline)).toEqual([
        { field: 'creditPolicyNote', message: 'Store instructions are required' },
        { field: 'contact', message: 'Add a contact email, phone, or representative email' },
      ]);
    });

    it('rejects an ordinary update that explicitly clears existing instructions', () => {
      expect(
        validatePolicyWrite(
          { creditPolicyNote: '   ' },
          { ...baseline, creditPolicyNote: 'Return monthly', contactPhone: '02 1234' },
        ),
      ).toContainEqual({ field: 'creditPolicyNote', message: 'Store instructions are required' });
    });

    it('does not validate an unchanged normalized policy payload', () => {
      expect(
        validatePolicyWrite(
          { creditPolicyNote: ' Return monthly ' },
          { ...baseline, creditPolicyNote: 'Return monthly' },
        ),
      ).toEqual([]);
    });
  });
});
