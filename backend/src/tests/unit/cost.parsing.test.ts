import { extractCostValueEnhanced } from "../../services/product.service";

// Test cases for the enhanced cost value extraction function
describe("extractCostValueEnhanced function", () => {
  it("should correctly parse basic numeric values", () => {
    expect(extractCostValueEnhanced("12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("100")).toBe(100);
    expect(extractCostValueEnhanced("0.99")).toBe(0.99);
    expect(extractCostValueEnhanced("1000.00")).toBe(1000.00);
  });

  it("should handle currency symbols at the beginning", () => {
    expect(extractCostValueEnhanced("$12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("€12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("£12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("¥1234")).toBe(1234);
    expect(extractCostValueEnhanced("¢12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("₹12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("₽12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("₪12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("₨12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("₩1234")).toBe(1234);
    expect(extractCostValueEnhanced("₦12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("₡12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("₫12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("Є12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("₴12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("₵12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("₸12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("₼12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("₾12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("₯12.34")).toBe(12.34);
  });

  it("should handle currency symbols at the end", () => {
    expect(extractCostValueEnhanced("12.34$")).toBe(12.34);
    expect(extractCostValueEnhanced("12.34€")).toBe(12.34);
    expect(extractCostValueEnhanced("12.34£")).toBe(12.34);
    expect(extractCostValueEnhanced("1234¥")).toBe(1234);
  });

  it("should handle currency abbreviations", () => {
    expect(extractCostValueEnhanced("USD 12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("EUR 12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("GBP 12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("AUD 12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("CAD 12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("JPY 1234")).toBe(1234);
  });

  it("should handle US number format with commas as thousands separators", () => {
    expect(extractCostValueEnhanced("1,234.56")).toBe(1234.56);
    expect(extractCostValueEnhanced("$1,234.56")).toBe(1234.56);
    expect(extractCostValueEnhanced("1,000,000.99")).toBe(1000000.99);
    expect(extractCostValueEnhanced("$1,000,000.99")).toBe(1000000.99);
  });

  it("should handle European number format with dots and commas", () => {
    expect(extractCostValueEnhanced("1.234,56")).toBe(1234.56);
    expect(extractCostValueEnhanced("1.234,56 €")).toBe(1234.56);
    expect(extractCostValueEnhanced("€ 1.234,56")).toBe(1234.56);
  });

  it("should handle values with parentheses (often used for negative values)", () => {
    expect(extractCostValueEnhanced("(12.34)")).toBe(12.34); // Extracting the positive value
    expect(extractCostValueEnhanced("$(12.34)")).toBe(12.34);
  });

  it("should handle values with spaces and formatting", () => {
    expect(extractCostValueEnhanced("  $ 12.34  ")).toBe(12.34);
    expect(extractCostValueEnhanced("EUR 1 234,56")).toBe(1234.56);
    expect(extractCostValueEnhanced("Rp 1.234,56")).toBe(1234.56);
  });

  it("should return null for invalid inputs", () => {
    expect(extractCostValueEnhanced("")).toBeNull();
    expect(extractCostValueEnhanced("not a number")).toBeNull();
    expect(extractCostValueEnhanced("abc")).toBeNull();
    expect(extractCostValueEnhanced("")).toBeNull();
  });

  it("should handle multiple decimal points correctly", () => {
    expect(extractCostValueEnhanced("12.34.56")).toBe(1234.56); // Treating first dot as thousands separator
    expect(extractCostValueEnhanced("12.34.56.78")).toBe(123456.78); // Multiple thousands separators
  });

  it("should handle negative values", () => {
    expect(extractCostValueEnhanced("-12.34")).toBe(-12.34);
    expect(extractCostValueEnhanced("$-12.34")).toBe(-12.34);
  });

  it("should handle complex currency representations", () => {
    expect(extractCostValueEnhanced("AUD$ 1,234.56")).toBe(1234.56);
    expect(extractCostValueEnhanced("CAD $1,234.56")).toBe(1234.56);
    expect(extractCostValueEnhanced("€ 1.234,56")).toBe(1234.56);  // European format
    expect(extractCostValueEnhanced("GBP 1,234.56")).toBe(1234.56);
    expect(extractCostValueEnhanced("¥1,234")).toBe(1234);
    expect(extractCostValueEnhanced("RMB 1,234.56")).toBe(1234.56);
    expect(extractCostValueEnhanced("Rp 1.234,56")).toBe(1234.56);
    expect(extractCostValueEnhanced("$ 1,234.56")).toBe(1234.56);
    expect(extractCostValueEnhanced("  € 1.234,56  ")).toBe(1234.56);  // With spaces
  });
});

// Test cases for flexible data validation with different number formats
describe("Flexible data validation for different number formats", () => {
  it("should handle US number format (comma as thousands separator, dot as decimal)", () => {
    expect(extractCostValueEnhanced("1,234.56")).toBe(1234.56);
    expect(extractCostValueEnhanced("12,345.67")).toBe(12345.67);
    expect(extractCostValueEnhanced("1,000,000.99")).toBe(1000000.99);
  });

  it("should handle European number format (dot as thousands separator, comma as decimal)", () => {
    expect(extractCostValueEnhanced("1.234,56")).toBe(1234.56);
    expect(extractCostValueEnhanced("12.345,67")).toBe(12345.67);
    expect(extractCostValueEnhanced("1.000.000,99")).toBe(1000000.99);
  });

  it("should handle mixed formats correctly", () => {
    // When both commas and dots exist, check which one is at the end
    expect(extractCostValueEnhanced("1.234,56")).toBe(1234.56);  // European
    expect(extractCostValueEnhanced("1,234.56")).toBe(1234.56);  // US
  });

  it("should handle numbers with thousands separators only", () => {
    expect(extractCostValueEnhanced("1,000")).toBe(1000);
    expect(extractCostValueEnhanced("1.000")).toBe(1000);
    expect(extractCostValueEnhanced("1,000,000")).toBe(1000000);
    expect(extractCostValueEnhanced("1.000.000")).toBe(1000000);
  });

  it("should handle decimal numbers without thousands separators", () => {
    expect(extractCostValueEnhanced("12.34")).toBe(12.34);
    expect(extractCostValueEnhanced("12,34")).toBe(12.34);
  });

  it("should handle various edge cases", () => {
    // Multiple decimals - likely thousands separators
    expect(extractCostValueEnhanced("12.34.56")).toBe(1234.56);
    expect(extractCostValueEnhanced("1.234.567")).toBe(1234567);
    expect(extractCostValueEnhanced("12,34,56")).toBe(123456);
    
    // Mixed with currency symbols
    expect(extractCostValueEnhanced("$1,234.56")).toBe(1234.56);
    expect(extractCostValueEnhanced("€1.234,56")).toBe(1234.56);
  });
});