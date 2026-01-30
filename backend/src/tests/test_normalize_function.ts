import { extractCostValueEnhanced } from '../utils/normalize.function';

// Test cases for the normalize and extract function
const testCases = [
  { input: '$12.34', expected: 12.34 },
  { input: '€12,34', expected: 12.34 },
  { input: '£1,234.56', expected: 1234.56 },
  { input: '¥1234', expected: 1234 },
  { input: '$1,234.56', expected: 1234.56 },
  { input: '1.234,56 €', expected: 1234.56 }, // European format
  { input: '1 234,56 €', expected: 1234.56 }, // With space separator
  { input: '(12.34)', expected: 12.34 }, // Parentheses for negative would be handled separately
  { input: 'CAD $12.34', expected: 12.34 }, // With currency abbreviation
  { input: 'Rp 1.234,56', expected: 1234.56 }, // Other currency formats
  { input: 'RMB 1,234.56', expected: 1234.56 }, // Another currency format
  { input: '', expected: null },
  { input: 'not a number', expected: null },
  { input: '12.34.56', expected: 1234.56 }, // Multiple decimals: first is thousands separator
  { input: '$ 12.34', expected: 12.34 }, // Space after currency
  { input: '  $ 12.34  ', expected: 12.34 }, // Extra spaces
];

console.log('Testing extractCostValueEnhanced function:');
console.log('===========================================');

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const result = extractCostValueEnhanced(testCase.input);
  const isSuccess = result === testCase.expected;

  console.log(
    `Input: "${testCase.input}" | Expected: ${testCase.expected} | Got: ${result} | ${isSuccess ? 'PASS' : 'FAIL'}`,
  );

  if (isSuccess) {
    passed++;
  } else {
    failed++;
  }
}

console.log('===========================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`Success rate: ${Math.round((passed / (passed + failed)) * 100)}%`);
