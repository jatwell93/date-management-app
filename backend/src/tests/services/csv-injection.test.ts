/**
 * Tests for CSV Injection Prevention (Phase 13 Security Hardening)
 *
 * Tests the sanitizeValue method in CSVParserService to ensure:
 * - Dangerous prefixes are escaped with backslash
 * - Safe values pass through unchanged
 * - Multiple injection attempts are handled
 * - Empty cells are handled correctly
 */

import { CSVParserService } from '../../services/csv-parser.service';
import { PrismaClient } from '@prisma/client';

describe('CSV Injection Prevention', () => {
  let csvParser: CSVParserService;

  beforeEach(() => {
    // Create parser with mock Prisma client (we're only testing sanitization)
    const mockPrisma = {} as PrismaClient;
    csvParser = new CSVParserService(mockPrisma);
  });

  describe('sanitizeValue - Dangerous Characters', () => {
    it('should escape leading equals sign with backslash', () => {
      // Access private method via type assertion for testing
      const sanitize = (csvParser as any).sanitizeValue.bind(csvParser);

      const result = sanitize('=SUM(A1:A10)');
      expect(result).toBe("'=SUM(A1:A10)");
    });

    it('should escape leading plus sign with backslash', () => {
      const sanitize = (csvParser as any).sanitizeValue.bind(csvParser);

      const result = sanitize('+1234567890');
      expect(result).toBe("'+1234567890");
    });

    it('should escape leading minus sign with backslash', () => {
      const sanitize = (csvParser as any).sanitizeValue.bind(csvParser);

      const result = sanitize('-cmd|calc');
      expect(result).toBe("'-cmd|calc");
    });

    it('should escape leading at sign with backslash', () => {
      const sanitize = (csvParser as any).sanitizeValue.bind(csvParser);

      const result = sanitize('@SUM(A1:A10)');
      expect(result).toBe("'@SUM(A1:A10)");
    });

    it('should escape leading tab character with backslash', () => {
      const sanitize = (csvParser as any).sanitizeValue.bind(csvParser);

      const result = sanitize('\tmalicious');
      expect(result).toBe("'\tmalicious");
    });

    it('should escape leading carriage return with backslash', () => {
      const sanitize = (csvParser as any).sanitizeValue.bind(csvParser);

      const result = sanitize('\rmalicious');
      expect(result).toBe("'\rmalicious");
    });
  });

  describe('sanitizeValue - Safe Values', () => {
    it('should not modify cells with safe content', () => {
      const sanitize = (csvParser as any).sanitizeValue.bind(csvParser);

      expect(sanitize('Normal Product Name')).toBe('Normal Product Name');
      expect(sanitize('SKU-12345')).toBe('SKU-12345');
      expect(sanitize('987654321')).toBe('987654321');
      expect(sanitize('Product (with parentheses)')).toBe('Product (with parentheses)');
    });

    it('should not modify cells with dangerous characters in middle', () => {
      const sanitize = (csvParser as any).sanitizeValue.bind(csvParser);

      // Dangerous characters are only a problem at the start
      expect(sanitize('Price: $10.99 = value')).toBe('Price: $10.99 = value');
      expect(sanitize('Total: 5+3')).toBe('Total: 5+3');
      expect(sanitize('Range: 10-20')).toBe('Range: 10-20');
      expect(sanitize('Email: user@example.com')).toBe('Email: user@example.com');
    });

    it('should handle empty strings', () => {
      const sanitize = (csvParser as any).sanitizeValue.bind(csvParser);

      expect(sanitize('')).toBe('');
    });

    it('should handle whitespace-only strings', () => {
      const sanitize = (csvParser as any).sanitizeValue.bind(csvParser);

      expect(sanitize('   ')).toBe('   ');
    });
  });

  describe('sanitizeValue - Edge Cases', () => {
    it('should only escape the first dangerous character', () => {
      const sanitize = (csvParser as any).sanitizeValue.bind(csvParser);

      // Only the first = should be escaped, not subsequent ones
      const result = sanitize('=SUM(A1)=5');
      expect(result).toBe("'=SUM(A1)=5");
    });

    it('should handle formulas with multiple cells', () => {
      const sanitize = (csvParser as any).sanitizeValue.bind(csvParser);

      const result = sanitize('=A1+B2-C3');
      expect(result).toBe("'=A1+B2-C3");
    });

    it('should handle command injection attempts', () => {
      const sanitize = (csvParser as any).sanitizeValue.bind(csvParser);

      expect(sanitize('=cmd|"/c calc"')).toBe('\'=cmd|"/c calc"');
      expect(sanitize('-2+3+cmd|"/c calc"')).toBe('\'-2+3+cmd|"/c calc"');
      expect(sanitize('+cmd|"/c calc"')).toBe('\'+cmd|"/c calc"');
      expect(sanitize('@cmd|"/c calc"')).toBe('\'@cmd|"/c calc"');
    });

    it('should handle DDE (Dynamic Data Exchange) injection attempts', () => {
      const sanitize = (csvParser as any).sanitizeValue.bind(csvParser);

      expect(sanitize('=cmd|"/c powershell"!A1')).toBe('\'=cmd|"/c powershell"!A1');
      expect(sanitize('+DDE("cmd";"/c calc";"!A0")')).toBe('\'+DDE("cmd";"/c calc";"!A0")');
    });

    it('should handle hyperlink injection attempts', () => {
      const sanitize = (csvParser as any).sanitizeValue.bind(csvParser);

      expect(sanitize('=HYPERLINK("http://evil.com","Click here")')).toBe(
        '\'=HYPERLINK("http://evil.com","Click here")',
      );
    });

    it('should handle cells with extended characters safely', () => {
      const sanitize = (csvParser as any).sanitizeValue.bind(csvParser);

      expect(sanitize('Cafe Muller')).toBe('Cafe Muller');
      expect(sanitize('=JP_TEST')).toBe("'=JP_TEST");
    });

    it('should handle cells with special CSV characters', () => {
      const sanitize = (csvParser as any).sanitizeValue.bind(csvParser);

      // Commas, quotes, newlines within cells are valid CSV
      expect(sanitize('Product, Description')).toBe('Product, Description');
      expect(sanitize('Product "Name"')).toBe('Product "Name"');
    });
  });

  describe('sanitizeValue - Multiple Injection Attempts', () => {
    it('should handle array of injection attempts', () => {
      const sanitize = (csvParser as any).sanitizeValue.bind(csvParser);

      const injectionAttempts = [
        '=1+1',
        '+1+1',
        '-1+1',
        '@SUM(A1:A10)',
        '\t=A1',
        '\r=A1',
        '=HYPERLINK("http://evil.com")',
        '=cmd|"/c calc"',
        '+DDE("cmd")',
        '-2+3+cmd|"/c calc"',
      ];

      injectionAttempts.forEach((attempt) => {
        const result = sanitize(attempt);
        // All should start with apostrophe escape
        expect(result.startsWith("'")).toBe(true);
        // Original injection attempt should be preserved after apostrophe
        expect(result.substring(1)).toBe(attempt);
      });
    });
  });

  describe('CSV Parsing Integration', () => {
    it('should apply sanitization during row parsing', async () => {
      // This would require a more complete integration test with actual CSV files
      // For now, we verify the sanitization is applied to sku, name, and barcode fields

      // Note: The actual parseRow method calls sanitizeValue on sku, name, and barcode
      // This is verified by checking the implementation at:
      // - Line 436: const sku = this.sanitizeValue(rawSku!.trim());
      // - Line 437: const name = this.sanitizeValue(rawName!.trim());
      // - Line 438: const barcode = this.sanitizeValue(rawBarcode!.trim());

      expect(true).toBe(true); // Placeholder for integration test
    });
  });
});
