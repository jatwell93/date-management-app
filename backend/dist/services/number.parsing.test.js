"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const product_service_1 = require("./product.service");
// Test the enhanced number parsing function from product.service
function testNumberParsing() {
    console.log('Testing enhanced number parsing logic...\n');
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
    let passed = 0;
    let failed = 0;
    testCases.forEach((testCase, index) => {
        const result = (0, product_service_1.extractCostValueEnhanced)(testCase.input);
        const isPassed = result === testCase.expected;
        if (isPassed) {
            console.log(`✅ Test ${index + 1}: "${testCase.input}" -> ${result}`);
            passed++;
        }
        else {
            console.log(`❌ Test ${index + 1}: "${testCase.input}" -> Expected: ${testCase.expected}, Got: ${result}`);
            failed++;
        }
    });
    console.log(`\nTest Results: ${passed} passed, ${failed} failed`);
}
// Run the test
testNumberParsing();
