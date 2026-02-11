/**
 * Unit tests for GS1-128 barcode parser
 */

import { parseGS1Barcode, isGS1Barcode } from '../gs1-parser';

describe('parseGS1Barcode', () => {
  describe('GTIN extraction (01)', () => {
    it('extracts GTIN from valid GS1 barcode', () => {
      const barcode = '(01)12345678901234(10)LOT123(17)250315';
      const result = parseGS1Barcode(barcode);

      expect(result.gtin).toBe('12345678901234');
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('handles GTIN without other fields', () => {
      const barcode = '(01)98765432109876';
      const result = parseGS1Barcode(barcode);

      expect(result.gtin).toBe('98765432109876');
      expect(result.isValid).toBe(true);
    });

    it('ignores invalid GTIN length', () => {
      const barcode = '(01)12345(10)LOT123';
      const result = parseGS1Barcode(barcode);

      expect(result.gtin).toBeUndefined();
      expect(result.batchLot).toBe('LOT123');
      expect(result.isValid).toBe(true);
    });
  });

  describe('Batch/Lot extraction (10)', () => {
    it('extracts batch number with space separator', () => {
      const barcode = '(01)12345678901234(10) LOT001(17)250315';
      const result = parseGS1Barcode(barcode);

      expect(result.batchLot).toBe('LOT001');
      expect(result.isValid).toBe(true);
    });

    it('handles batch numbers with special characters', () => {
      const barcode = '(10) BATCH-2025/03';
      const result = parseGS1Barcode(barcode);

      expect(result.batchLot).toBe('BATCH-2025/03');
      expect(result.isValid).toBe(true);
    });

    it('trims whitespace from batch numbers', () => {
      const barcode = '(10)  LOT 123  ';
      const result = parseGS1Barcode(barcode);

      expect(result.batchLot).toBe('LOT 123');
    });
  });

  describe('Expiry date extraction (17)', () => {
    it('converts YYMMDD to ISO date', () => {
      const barcode = '(17)250315';
      const result = parseGS1Barcode(barcode);

      expect(result.expiryDate).toBe('2025-03-15');
      expect(result.isValid).toBe(true);
    });

    it('handles century boundary (50 = 1950, 49 = 2049)', () => {
      expect(parseGS1Barcode('(17)500101').expiryDate).toBe('1950-01-01');
      expect(parseGS1Barcode('(17)490101').expiryDate).toBe('2049-01-01');
    });

    it('rejects invalid dates', () => {
      const result = parseGS1Barcode('(17)251234'); // Invalid month/day

      expect(result.expiryDate).toBeUndefined();
      expect(result.errors).toContain('Invalid expiry date format: 251234');
      expect(result.isValid).toBe(false);
    });

    it('rejects malformed date strings', () => {
      const result = parseGS1Barcode('(17)251234'); // Invalid date (month 12, day 34)

      expect(result.expiryDate).toBeUndefined();
      expect(result.errors).toContain('Invalid expiry date format: 251234');
    });
  });

  describe('Serial number extraction (21)', () => {
    it('extracts serial number', () => {
      const barcode = '(21) SN123456789';
      const result = parseGS1Barcode(barcode);

      expect(result.serialNumber).toBe('SN123456789');
      expect(result.isValid).toBe(true);
    });

    it('handles serial numbers with spaces', () => {
      const barcode = '(21) SERIAL 001';
      const result = parseGS1Barcode(barcode);

      expect(result.serialNumber).toBe('SERIAL 001');
    });
  });

  describe('Complete pharmacy barcode', () => {
    it('parses full pharmaceutical GS1 barcode', () => {
      const barcode = '(01)12345678901234(10)LOT001(17)250315(21)SN123';
      const result = parseGS1Barcode(barcode);

      expect(result).toEqual({
        raw: barcode,
        gtin: '12345678901234',
        batchLot: 'LOT001',
        expiryDate: '2025-03-15',
        serialNumber: 'SN123',
        isValid: true,
        errors: [],
      });
    });

    it('handles real pharmacy barcode format', () => {
      // Example from Australian pharmacy standards
      const barcode = '(01)19312345678901(10)ABC123(17)260515(21)XYZ789';
      const result = parseGS1Barcode(barcode);

      expect(result.gtin).toBe('19312345678901');
      expect(result.batchLot).toBe('ABC123');
      expect(result.expiryDate).toBe('2026-05-15');
      expect(result.serialNumber).toBe('XYZ789');
      expect(result.isValid).toBe(true);
    });
  });

  describe('Non-GS1 barcodes', () => {
    it('handles regular EAN-13 barcode', () => {
      const barcode = '1234567890123';
      const result = parseGS1Barcode(barcode);

      expect(result.raw).toBe(barcode);
      expect(result.gtin).toBeUndefined();
      expect(result.batchLot).toBeUndefined();
      expect(result.expiryDate).toBeUndefined();
      expect(result.serialNumber).toBeUndefined();
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(0);
    });

    it('handles Code 128 non-GS1 barcode', () => {
      const barcode = 'ABC123DEF456';
      const result = parseGS1Barcode(barcode);

      expect(result.raw).toBe(barcode);
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Error handling', () => {
    it('handles empty barcode', () => {
      const result = parseGS1Barcode('');

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid barcode: must be a non-empty string');
    });

    it('handles null/undefined barcode', () => {
      expect(parseGS1Barcode(null as any).isValid).toBe(false);
      expect(parseGS1Barcode(undefined as any).isValid).toBe(false);
    });

    it('handles malformed GS1 data gracefully', () => {
      const barcode = '(01)invalid(10)';
      const result = parseGS1Barcode(barcode);

      expect(result.gtin).toBeUndefined();
      expect(result.batchLot).toBeUndefined();
      expect(result.isValid).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('handles multiple spaces in batch numbers', () => {
      const barcode = '(10)  BATCH   123  ';
      const result = parseGS1Barcode(barcode);

      expect(result.batchLot).toBe('BATCH   123');
    });

    it('handles minimum length fields', () => {
      const barcode = '(01)12345678901234(10)A(17)250101(21)1';
      const result = parseGS1Barcode(barcode);

      expect(result.gtin).toBe('12345678901234');
      expect(result.batchLot).toBe('A');
      expect(result.expiryDate).toBe('2025-01-01');
      expect(result.serialNumber).toBe('1');
      expect(result.isValid).toBe(true);
    });
  });
});

describe('isGS1Barcode', () => {
  it('returns true for barcodes with GS1 AIs', () => {
    expect(isGS1Barcode('(01)12345678901234')).toBe(true);
    expect(isGS1Barcode('(10)LOT123')).toBe(true);
    expect(isGS1Barcode('(17)250315')).toBe(true);
    expect(isGS1Barcode('(21)SN123')).toBe(true);
    expect(isGS1Barcode('(01)123(10)ABC(17)250101(21)XYZ')).toBe(true);
  });

  it('returns false for non-GS1 barcodes', () => {
    expect(isGS1Barcode('1234567890123')).toBe(false);
    expect(isGS1Barcode('ABC123DEF')).toBe(false);
    expect(isGS1Barcode('')).toBe(false);
    expect(isGS1Barcode('INVALID')).toBe(false);
  });

  it('returns false for empty or invalid input', () => {
    expect(isGS1Barcode('')).toBe(false);
    expect(isGS1Barcode(null as any)).toBe(false);
    expect(isGS1Barcode(undefined as any)).toBe(false);
  });
});
