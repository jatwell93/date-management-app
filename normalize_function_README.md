# Numeric String Normalization and Cost Value Extraction

This module provides functions for normalizing numeric strings with various currency symbols and formats, and for extracting numeric values from those strings.

## Functions

### `normalizeNumericString(input: string): string`
Normalizes a string containing a numeric value with currency symbols and formatting by:
- Removing common currency symbols (¥€£¢₹₽₪₨₩₦₡₫Є₴₵₸₺₼₾₯$) at the beginning or end
- Removing parentheses used for negative values
- Removing spaces and common thousands separators

### `extractCostValueEnhanced(costStr: string): number | null`
Extracts a numeric value from a formatted cost string, supporting:
- Various currency symbols
- Different decimal/thousands separator conventions (US vs European)
- Parentheses for negative values
- Multiple currency formats

## Usage Examples

```typescript
import { extractCostValueEnhanced } from './temp_normalize_function';

// Various currency formats
console.log(extractCostValueEnhanced("$12.34"));      // 12.34
console.log(extractCostValueEnhanced("€12,34"));      // 12.34 (European format)
console.log(extractCostValueEnhanced("£1,234.56"));   // 1234.56 (US format)
console.log(extractCostValueEnhanced("¥1234"));       // 1234
console.log(extractCostValueEnhanced("1.234,56 €"));  // 1234.56 (European format)
console.log(extractCostValueEnhanced("  $ 12.34  ")); // 12.34 (with extra spaces)
```

## Features

- Handles multiple currency symbols
- Supports both US (1,234.56) and European (1.234,56) number formats
- Removes extra spaces and formatting
- Handles edge cases like "12.34.56" where the first dot is treated as a thousands separator
- Returns null for invalid inputs