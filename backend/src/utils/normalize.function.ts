// Helper function to normalize numeric strings by handling various currency symbols, spaces, and formatting
function normalizeNumericString(input: string): string {
  // Remove common currency symbols at the beginning or end, including additional ones
  let cleaned = input.trim();

  // More comprehensive currency symbol removal
  cleaned = cleaned.replace(/^[¥€£¢₹₽₪₨₩₦₡₫Є₴₵₸₺₼₾₯$]/, '');
  cleaned = cleaned.replace(/[¥€£¢₹₽₪₨₩₦₡₫Є₴₵₸₺₼₾₯$]$/, '');

  // Remove additional formatting like parentheses (often used for negative values) temporarily
  // and other common characters that might indicate currency or formatting
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    cleaned = cleaned.substring(1, cleaned.length - 1);
  }

  // Remove common thousands separators and spaces
  // Keep only digits, decimal points, and commas temporarily for format analysis
  cleaned = cleaned.replace(/[ ]/g, ''); // Remove any spaces first

  return cleaned;
}

// Enhanced helper function to extract numeric value from cost string with flexible formatting
export function extractCostValueEnhanced(costStr: string): number | null {
  // Use the normalizeNumericString helper to clean up the input
  let cleanedStr = normalizeNumericString(costStr);

  // Remove any other non-numeric characters except decimal point and comma (for thousands)
  // Keep only digits, decimal point, and comma
  cleanedStr = cleanedStr.replace(/[^\d.,]/g, '');

  // Handle different decimal/thousands separator conventions
  const commaCount = (cleanedStr.match(/,/g) || []).length;
  const dotCount = (cleanedStr.match(/\./g) || []).length;

  // Determine the most likely decimal separator based on format
  // European format: 1.234,56 (dots for thousands, comma for decimal)
  // US format: 1,234.56 (comma for thousands, dot for decimal)
  // We'll assume that the rightmost occurrence of either comma or dot as decimal separator
  if (commaCount > 0 && dotCount > 0) {
    // If both exist, check which one is at the end (likely decimal separator)
    const endsWithDigitPattern = /\d{1,2}$/;
    if (cleanedStr.includes(',') && endsWithDigitPattern.test(cleanedStr)) {
      // Check if string ends with comma followed by 1-2 digits (European format)
      const europeanPattern = /,\d{1,2}$/;
      if (europeanPattern.test(cleanedStr)) {
        // European format: swap meaning - commas are thousands, last dot is decimal
        cleanedStr = cleanedStr.replace(/\./g, ''); // Remove dots (thousands separators)
        cleanedStr = cleanedStr.replace(/,/, '.'); // Replace last comma with dot (decimal)
      } else {
        // US format: commas are thousands, last dot is decimal
        cleanedStr = cleanedStr.replace(/,/g, ''); // Remove commas (thousands separators)
      }
    } else if (cleanedStr.includes('.') && endsWithDigitPattern.test(cleanedStr)) {
      // Check if string ends with dot followed by 1-2 digits (US format)
      const usPattern = /\.\d{1,2}$/;
      if (usPattern.test(cleanedStr)) {
        // US format: commas are thousands, last dot is decimal
        cleanedStr = cleanedStr.replace(/,/g, ''); // Remove commas (thousands separators)
      } else {
        // For other patterns, default to US format
        cleanedStr = cleanedStr.replace(/,/g, ''); // Remove commas (thousands separators)
      }
    } else {
      // Default to US format: commas as thousands separators
      cleanedStr = cleanedStr.replace(/,/g, ''); // Remove commas (thousands separators)
    }
  } else if (commaCount > 1) {
    // Multiple commas - assume thousands separators (US format)
    cleanedStr = cleanedStr.replace(/,/g, ''); // Remove all commas
  } else if (commaCount === 1) {
    // Single comma - check if followed by 1-2 digits (likely decimal separator)
    if (cleanedStr.match(/,\d{1,2}$/)) {
      cleanedStr = cleanedStr.replace(/,/, '.'); // Replace comma with dot (decimal)
    } else {
      // Otherwise treat as thousands separator
      cleanedStr = cleanedStr.replace(/,/, ''); // Remove comma (thousands separator)
    }
  } else if (dotCount > 1) {
    // Multiple dots - assume thousands separators
    cleanedStr = cleanedStr.replace(/\.(?=.*\.)/g, ''); // Remove all but last dot
  }

  // Now parse as float
  const value = parseFloat(cleanedStr);

  if (isNaN(value)) {
    return null;
  }

  return value;
}

export function escapeHtmlString(input: string): string {
  return input.replace(/[&<>"'`=\/]/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      case '`':
        return '&#96;';
      case '=':
        return '&#61;';
      case '/':
        return '&#47;';
      default:
        return char;
    }
  });
}

export function escapeHtml<T>(value: T): T {
  if (typeof value === 'string') {
    return escapeHtmlString(value) as unknown as T;
  }

  if (value instanceof Date) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => escapeHtml(item)) as unknown as T;
  }

  if (value && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] = escapeHtml(val);
    }
    return sanitized as T;
  }

  return value;
}
