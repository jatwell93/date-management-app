import { extractCostValueEnhanced } from '../services/product.service';

// Test cases with expected results
const testCases = [
  { input: '12.34', expected: 12.34 },
  { input: '100', expected: 100 },
  { input: '0.99', expected: 0.99 },
  { input: '1000.00', expected: 1000.0 },
  { input: '$12.34', expected: 12.34 },
  { input: '€12.34', expected: 12.34 },
  { input: '£12.34', expected: 12.34 },
  { input: '¥1234', expected: 1234 },
  { input: '¢12.34', expected: 12.34 },
  { input: '₹12.34', expected: 12.34 },
  { input: '₽12.34', expected: 12.34 },
  { input: '₪12.34', expected: 12.34 },
  { input: '₨12.34', expected: 12.34 },
  { input: '₩1234', expected: 1234 },
  { input: '₦12.34', expected: 12.34 },
  { input: '₡12.34', expected: 12.34 },
  { input: '(12.34)', expected: -12.34 },
  { input: '$(12.34)', expected: -12.34 },
  { input: '1,234.56', expected: 1234.56 },
  { input: '1.234,56', expected: 1234.56 },
  { input: 'EUR 1 234,56', expected: 1234.56 },
  { input: '12.34.56', expected: 1234.56 }, // Problem: should be 1234.56 (rightmost dot is decimal)
  { input: '¥1,234', expected: 1234 },
  { input: '1,000', expected: 1000 },
  { input: '1.000', expected: 1000 },
  { input: '-12.34', expected: -12.34 },
  { input: ' 12.34 ', expected: 12.34 },
  { input: '12,34', expected: 12.34 },
  { input: '1234,56', expected: 1234.56 },
  { input: '12.34.567', expected: 1234.567 },
  { input: '12,34,56', expected: 1234.56 },
  { input: '$ 1,234.56', expected: 1234.56 },
  { input: 'USD 1,234.56', expected: 1234.56 },
  { input: '1 234.56', expected: 1234.56 }, // space as thousands separator
  { input: '1 234,56', expected: 1234.56 }, // space and comma
  { input: 'CAD $1,234.56', expected: 1234.56 },
  { input: '(CAD $1,234.56)', expected: -1234.56 },
];

console.log('Testing extractCostValueEnhanced function:\n');

let passedTests = 0;
let totalTests = testCases.length;

for (const testCase of testCases) {
  const result = extractCostValueEnhanced(testCase.input);
  const passed = result === testCase.expected;

  console.log(
    `Input: "${testCase.input}" | Expected: ${testCase.expected} | Got: ${result} | ${passed ? 'PASS' : 'FAIL'}`,
  );

  if (passed) {
    passedTests++;
  }
}

console.log(`\nResults: ${passedTests}/${totalTests} tests passed`);

if (passedTests !== totalTests) {
  console.log('\nSome tests failed. Please review the implementation.');
  process.exit(1);
} else {
  console.log('\nAll tests passed!');
  process.exit(0);
}
