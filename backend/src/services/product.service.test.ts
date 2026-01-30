import { extractCostValueEnhanced } from './product.service';

// Simple test to verify the enhanced number parsing functionality
describe('extractCostValueEnhanced function', () => {
  it('should correctly parse various number formats', () => {
    const testCases = [
      { input: '12.34', expected: 12.34 },
      { input: '1,234.56', expected: 1234.56 },
      { input: '1.234,56', expected: 1234.56 }, // European format
      { input: '$12.34', expected: 12.34 },
      { input: '€1.234,56', expected: 1234.56 },
      { input: '12', expected: 12 },
      { input: '0.99', expected: 0.99 },
      { input: '1,000,000.99', expected: 1000000.99 },
      { input: 'invalid', expected: null },
      { input: '', expected: null },
      { input: 'abc123', expected: 123 }, // Should extract just the number
    ];

    testCases.forEach((testCase) => {
      const result = extractCostValueEnhanced(testCase.input);
      expect(result).toBe(testCase.expected);
    });
  });
});
