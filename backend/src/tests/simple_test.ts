// Simple test for extractCostValueEnhanced using the actual implementation from product.service.ts
// Since we can't import due to database type issues, we'll copy the function implementation here

// Enhanced helper function to extract numeric value from cost string with flexible formatting
function extractCostValueEnhanced(costStr: string): number | null {
  let cleanedStr = costStr.trim();
  let isNegative = false;

  // 1. Handle negative values in parentheses first, e.g., "(12.34)" or "$(12.34)"
  if (cleanedStr.includes('(') && cleanedStr.includes(')')) {
    const openParenIndex = cleanedStr.lastIndexOf('('); // Use last occurrence to handle cases like "$(12.34)"
    const closeParenIndex = cleanedStr.indexOf(')', openParenIndex);
    if (closeParenIndex > openParenIndex) {
      isNegative = true;
      // Extract the content inside the parentheses
      const insideParen = cleanedStr.substring(openParenIndex + 1, closeParenIndex);
      // Remove the parentheses and what's around them
      cleanedStr = cleanedStr.substring(0, openParenIndex) + insideParen + cleanedStr.substring(closeParenIndex + 1);
    }
  }

  // 2. Remove common currency symbols and codes (this includes currency codes like USD, EUR)
  // More comprehensive pattern to match currency symbols and codes at start or end
  cleanedStr = cleanedStr.replace(/([A-Z]{3,4}[\s]*)|([\s]*[A-Z]{3,4})|[\s$€£¥₹₽₪₨₩₦₡₫Є₴₵₸₺₼₾₯]/gi, '');
  
  // 3. Normalize spaces (remove all spaces)
  cleanedStr = cleanedStr.trim().replace(/\s+/g, '');

  // 4. Handle explicit negative sign if not already handled by parentheses
  if (cleanedStr.startsWith('-')) {
    isNegative = true;
    cleanedStr = cleanedStr.substring(1);
  }

  // 5. Count and analyze separators to determine decimal vs. thousands
  const dotCount = (cleanedStr.match(/\./g) || []).length;
  const commaCount = (cleanedStr.match(/,/g) || []).length;
  
  let normalizedStr = cleanedStr;
  
  if (dotCount === 0 && commaCount === 0) {
    // No separators - just digits
    normalizedStr = cleanedStr;
  } else if (dotCount === 1 && commaCount === 0) {
    // Single dot - US format (decimal)
    normalizedStr = cleanedStr;
  } else if (dotCount === 0 && commaCount === 1) {
    // Single comma - might be European decimal or thousands separator
    const commaIndex = cleanedStr.lastIndexOf(',');
    const afterComma = cleanedStr.substring(commaIndex + 1);
    
    // If after comma is 1-3 digits, it's likely a decimal separator
    if (/^\d{1,3}$/.test(afterComma)) {
      // European format: use comma as decimal point
      normalizedStr = cleanedStr.replace(',', '.');
    } else {
      // Thousands separator
      normalizedStr = cleanedStr.replace(/,/g, '');
    }
  } else if (commaCount === 0 && dotCount === 1) {
    // Single dot - US format (decimal)
    normalizedStr = cleanedStr;
  } else if (dotCount === 0 && commaCount === 1) {
    // Single comma - European format (decimal)
    normalizedStr = cleanedStr.replace(',', '.');
  } else {
    // Multiple separators - rightmost one is decimal separator
    const lastDotIndex = cleanedStr.lastIndexOf('.');
    const lastCommaIndex = cleanedStr.lastIndexOf(',');
    
    // The rightmost separator is the decimal point
    if (lastDotIndex > lastCommaIndex) {
      // Last separator is dot: US format (dot is decimal, commas are thousands)
      const integerPart = cleanedStr.substring(0, lastDotIndex).replace(/,/g, '');
      const decimalPart = cleanedStr.substring(lastDotIndex + 1);
      normalizedStr = integerPart + '.' + decimalPart;
    } else if (lastCommaIndex > lastDotIndex) {
      // Last separator is comma: European format (comma is decimal, dots are thousands)
      const integerPart = cleanedStr.substring(0, lastCommaIndex).replace(/\./g, '');
      const decimalPart = cleanedStr.substring(lastCommaIndex + 1);
      normalizedStr = integerPart + '.' + decimalPart;
    } else {
      // Both have same last index (shouldn't happen in practice with our approach)
      // Default to keeping original
      normalizedStr = cleanedStr;
    }
  }

  // Handle special case for "1,000" or "1.000" where there's no decimal part
  if (normalizedStr.match(/^[0-9]+[,.][0-9]{3}$/)) {
    // This is likely a thousands separator, not a decimal separator
    normalizedStr = normalizedStr.replace(/[,.]/, '');
  }

  // 6. Final cleanup to ensure only digits and a single dot remain
  normalizedStr = normalizedStr.replace(/[^\d.]/g, '');
  
  // Ensure there's only one decimal point (in case multiple were introduced)
  const parts = normalizedStr.split('.');
  if (parts.length > 2) {
    // If there are multiple decimal points, join all but the last part with no separator, 
    // then add the last part as decimal
    const integerPart = parts.slice(0, -1).join('');
    const decimalPart = parts[parts.length - 1];
    normalizedStr = integerPart + '.' + decimalPart;
  }

  // Parse the value
  const value = parseFloat(normalizedStr);
  
  if (isNaN(value)) {
    return null;
  }

  // Apply negative sign if originally detected
  return isNegative ? -value : value;
}

// Test cases with expected results
const testCases = [
  { input: "12.34", expected: 12.34 },
  { input: "100", expected: 100 },
  { input: "0.99", expected: 0.99 },
  { input: "1000.00", expected: 1000.00 },
  { input: "$12.34", expected: 12.34 },
  { input: "€12.34", expected: 12.34 },
  { input: "£12.34", expected: 12.34 },
  { input: "¥1234", expected: 1234 },
  { input: "¢12.34", expected: 12.34 },
  { input: "₹12.34", expected: 12.34 },
  { input: "₽12.34", expected: 12.34 },
  { input: "₪12.34", expected: 12.34 },
  { input: "₨12.34", expected: 12.34 },
  { input: "₩1234", expected: 1234 },
  { input: "₦12.34", expected: 12.34 },
  { input: "₡12.34", expected: 12.34 },
  { input: "(12.34)", expected: -12.34 },
  { input: "$(12.34)", expected: -12.34 },
  { input: "1,234.56", expected: 1234.56 },
  { input: "1.234,56", expected: 1234.56 },
  { input: "EUR 1 234,56", expected: 1234.56 },
  { input: "12.34.56", expected: 1234.56 },  // Problem: should be 1234.56 (rightmost dot is decimal)
  { input: "¥1,234", expected: 1234 },
  { input: "1,000", expected: 1000 },
  { input: "1.000", expected: 1000 },
  { input: "-12.34", expected: -12.34 },
  { input: " 12.34 ", expected: 12.34 },
  { input: "12,34", expected: 12.34 },
  { input: "1234,56", expected: 1234.56 },
  { input: "12.34.567", expected: 1234.567 },
  { input: "12,34,56", expected: 1234.56 },
  { input: "$ 1,234.56", expected: 1234.56 },
  { input: "USD 1,234.56", expected: 1234.56 },
  { input: "1 234.56", expected: 1234.56 },  // space as thousands separator
  { input: "1 234,56", expected: 1234.56 },  // space and comma
  { input: "CAD $1,234.56", expected: 1234.56 },
  { input: "(CAD $1,234.56)", expected: -1234.56 },
];

console.log("Testing extractCostValueEnhanced function:\n");

let passedTests = 0;
let totalTests = testCases.length;

for (const testCase of testCases) {
  const result = extractCostValueEnhanced(testCase.input);
  const passed = result === testCase.expected;
  
  console.log(
    `Input: "${testCase.input}" | Expected: ${testCase.expected} | Got: ${result} | ${passed ? 'PASS' : 'FAIL'}`
  );
  
  if (passed) {
    passedTests++;
  }
}

console.log(`\nResults: ${passedTests}/${totalTests} tests passed`);

if (passedTests !== totalTests) {
  console.log("\nSome tests failed. Please review the implementation.");
  process.exit(1);
} else {
  console.log("\nAll tests passed!");
  process.exit(0);
}