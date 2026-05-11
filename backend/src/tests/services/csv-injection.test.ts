/**
 * Tests for CSV Injection Prevention (Phase 13 Security Hardening)
 *
 * Verifies product row validation neutralizes spreadsheet formula injection by
 * prefixing dangerous cell values with an apostrophe.
 */

import { validateProductRowStrictly } from '../../services/csv-parser.service';

describe('CSV Injection Prevention', () => {
  const productHeaderMap = new Map<string, string>([
    ['sku', 'SKU'],
    ['name', 'Name'],
    ['barcode', 'Barcode'],
    ['cost', 'Cost'],
  ]);

  type SanitizedProductField = 'sku' | 'name' | 'barcode';

  function parseProductField(value: string, field: SanitizedProductField = 'sku'): string {
    const record: Record<string, string> = {
      SKU: 'SAFE-SKU',
      Name: 'Safe Product',
      Barcode: '123456789',
      Cost: '12.99',
    };
    const header = productHeaderMap.get(field);
    if (!header) {
      throw new Error(`Missing header mapping for ${field}`);
    }

    record[header] = value;

    const result = validateProductRowStrictly(record, 1, productHeaderMap, new Set());

    expect(result.errors).toEqual([]);
    expect(result.row).not.toBeNull();

    return result.row![field];
  }

  describe('dangerous leading characters', () => {
    it.each([
      ['equals sign', '=SUM(A1:A10)', "'=SUM(A1:A10)"],
      ['plus sign', '+1234567890', "'+1234567890"],
      ['minus sign', '-cmd|calc', "'-cmd|calc"],
      ['at sign', '@SUM(A1:A10)', "'@SUM(A1:A10)"],
      ['tab-prefixed formula', '\t=A1', "'=A1"],
      ['carriage-return-prefixed formula', '\r=A1', "'=A1"],
    ])('escapes a leading %s with an apostrophe', (_label, value, expected) => {
      expect(parseProductField(value)).toBe(expected);
    });
  });

  describe('safe values', () => {
    it('does not modify safe product fields', () => {
      expect(parseProductField('Normal Product Name', 'name')).toBe('Normal Product Name');
      expect(parseProductField('SKU-12345')).toBe('SKU-12345');
      expect(parseProductField('987654321', 'barcode')).toBe('987654321');
      expect(parseProductField('Product (with parentheses)', 'name')).toBe(
        'Product (with parentheses)',
      );
    });

    it('does not modify dangerous characters that are not leading characters', () => {
      expect(parseProductField('Price: $10.99 = value', 'name')).toBe('Price: $10.99 = value');
      expect(parseProductField('Total: 5+3', 'name')).toBe('Total: 5+3');
      expect(parseProductField('Range: 10-20', 'name')).toBe('Range: 10-20');
      expect(parseProductField('Email: user@example.com', 'name')).toBe('Email: user@example.com');
    });
  });

  describe('edge cases', () => {
    it('only escapes the first dangerous character', () => {
      expect(parseProductField('=SUM(A1)=5')).toBe("'=SUM(A1)=5");
    });

    it('handles formulas with multiple cells', () => {
      expect(parseProductField('=A1+B2-C3')).toBe("'=A1+B2-C3");
    });

    it('handles command injection attempts', () => {
      expect(parseProductField('=cmd|"/c calc"')).toBe('\'=cmd|"/c calc"');
      expect(parseProductField('-2+3+cmd|"/c calc"')).toBe('\'-2+3+cmd|"/c calc"');
      expect(parseProductField('+cmd|"/c calc"')).toBe('\'+cmd|"/c calc"');
      expect(parseProductField('@cmd|"/c calc"')).toBe('\'@cmd|"/c calc"');
    });

    it('handles DDE injection attempts', () => {
      expect(parseProductField('=cmd|"/c powershell"!A1')).toBe('\'=cmd|"/c powershell"!A1');
      expect(parseProductField('+DDE("cmd";"/c calc";"!A0")')).toBe(
        '\'+DDE("cmd";"/c calc";"!A0")',
      );
    });

    it('handles hyperlink injection attempts', () => {
      expect(parseProductField('=HYPERLINK("http://evil.com","Click here")')).toBe(
        '\'=HYPERLINK("http://evil.com","Click here")',
      );
    });

    it('handles cells with extended characters safely', () => {
      expect(parseProductField('Cafe Muller', 'name')).toBe('Cafe Muller');
      expect(parseProductField('=JP_TEST')).toBe("'=JP_TEST");
    });

    it('handles cells with special CSV characters', () => {
      expect(parseProductField('Product, Description', 'name')).toBe('Product, Description');
      expect(parseProductField('Product "Name"', 'name')).toBe('Product "Name"');
    });
  });

  describe('multiple injection attempts', () => {
    it('prefixes each dangerous value with an apostrophe and preserves the original value', () => {
      const injectionAttempts = [
        ['=1+1', "'=1+1"],
        ['+1+1', "'+1+1"],
        ['-1+1', "'-1+1"],
        ['@SUM(A1:A10)', "'@SUM(A1:A10)"],
        ['\t=A1', "'=A1"],
        ['\r=A1', "'=A1"],
        ['=HYPERLINK("http://evil.com")', '\'=HYPERLINK("http://evil.com")'],
        ['=cmd|"/c calc"', '\'=cmd|"/c calc"'],
        ['+DDE("cmd")', '\'+DDE("cmd")'],
        ['-2+3+cmd|"/c calc"', '\'-2+3+cmd|"/c calc"'],
      ];

      injectionAttempts.forEach(([attempt, expected]) => {
        const result = parseProductField(attempt);
        expect(result.startsWith("'")).toBe(true);
        expect(result).toBe(expected);
      });
    });
  });

  describe('row parsing behavior', () => {
    it('applies sanitization to sku, name, and barcode fields', () => {
      const result = validateProductRowStrictly(
        {
          SKU: '=SKU_FORMULA',
          Name: '+NAME_FORMULA',
          Barcode: '@BARCODE_FORMULA',
          Cost: '12.99',
        },
        1,
        productHeaderMap,
        new Set(),
      );

      expect(result.errors).toEqual([]);
      expect(result.row).toMatchObject({
        sku: "'=SKU_FORMULA",
        name: "'+NAME_FORMULA",
        barcode: "'@BARCODE_FORMULA",
      });
    });
  });
});
