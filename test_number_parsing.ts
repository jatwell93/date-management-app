import { extractCostValueEnhanced } from './backend/src/services/product.service';

// Test cases for the enhanced cost value extraction
const testCases = [
  { input: "$12.99", expected: 12.99 },
  { input: "€15.50", expected: 15.50 },
  { input: "¥1,234.56", expected: 1234.56 },
  { input: "1.234,56", expected: 1234.56 }, // European format
  { input: "1,234.56", expected: 1234.56 }, // US format
  { input: "  $25.99  ", expected: 25.99 }, // With spaces
  { input: "GBP 10.45", expected: 10.45 },
  { input: "CAD20.33", expected: 20.33 },
  { input: "100", expected: 100 },
  { input: "0.99", expected: 0.99 },
  { input: "(15.75)", expected: 15.75 }, // Negative in parentheses
  { input: "", expected: null },
  { input: "abc", expected: null },
  { input: "not a number", expected: null }
];

console.log('Testing extractCostValueEnhanced function...\n');

let passed = 0;
let failed = 0;

testCases.forEach((testCase, index) => {
  const result = extractCostValueEnhanced(testCase.input);
  const success = result === testCase.expected;
  
  if (success) {
    console.log(`✅ Test ${index + 1} PASSED: "${testCase.input}" -> ${result}`);
    passed++;
  } else {
    console.log(`❌ Test ${index + 1} FAILED: "${testCase.input}" -> Expected: ${testCase.expected}, Got: ${result}`);
    failed++;
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('🎉 All tests passed!');
} else {
  console.log('⚠️  Some tests failed. Please review the implementation.');
}