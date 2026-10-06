// Cost-cell parsing for product-catalogue imports.
//
// Copied unchanged from Express's `product-import.helpers.ts` so the Worker and
// Express read a cost cell identically. The Worker's own parser stripped every
// character that was not a digit, dot or minus, which read the European "12,50"
// as 1250 and "(12.50)" as a positive number. This version handles currency
// symbols and codes, both thousands conventions, and accounting-style negatives.

interface CostTextState {
  text: string;
  isNegative: boolean;
}

export function parseProductImportCost(costStr: string): number | null {
  const prepared = prepareCostText(costStr);
  const normalized = collapseExtraDecimalPoints(
    stripNonNumericCostCharacters(normalizeCostSeparators(prepared.text)),
  );
  return parsePreparedCostValue(normalized, prepared.isNegative);
}

function prepareCostText(costStr: string): CostTextState {
  return extractLeadingNegative(stripCurrencyText(extractParenthesizedNegative(costStr.trim())));
}

function extractParenthesizedNegative(text: string): CostTextState {
  const openParenIndex = text.lastIndexOf('(');
  const closeParenIndex = text.indexOf(')', openParenIndex);

  if (openParenIndex === -1) {
    return { text, isNegative: false };
  }

  if (closeParenIndex <= openParenIndex) {
    return { text, isNegative: false };
  }

  const insideParen = text.substring(openParenIndex + 1, closeParenIndex);
  return {
    text: text.substring(0, openParenIndex) + insideParen + text.substring(closeParenIndex + 1),
    isNegative: true,
  };
}

function stripCurrencyText(state: CostTextState): CostTextState {
  return {
    text: state.text
      .replace(/([A-Z]{3,4}[\s]*)|([\s]*[A-Z]{3,4})|[\s$€£¥₹₽₪₨₩₦₡₫Є₴₵₸₺₼₾₯]/gi, '')
      .trim()
      .replace(/\s+/g, ''),
    isNegative: state.isNegative,
  };
}

function extractLeadingNegative(state: CostTextState): CostTextState {
  if (!state.text.startsWith('-')) {
    return state;
  }

  return { text: state.text.substring(1), isNegative: true };
}

function normalizeCostSeparators(text: string): string {
  const dotCount = countOccurrences(text, '.');
  const commaCount = countOccurrences(text, ',');

  if (dotCount > 1 && commaCount === 0) {
    return normalizeMultipleDots(text);
  }

  if (commaCount > 1 && dotCount === 0) {
    return text.replace(/,/g, '');
  }

  if (dotCount === 0 && commaCount === 1) {
    return normalizeSingleComma(text);
  }

  if (dotCount > 0 && commaCount > 0) {
    return normalizeMixedSeparators(text);
  }

  return text;
}

function countOccurrences(text: string, character: string): number {
  return (text.match(new RegExp(`\\${character}`, 'g')) || []).length;
}

function normalizeMultipleDots(text: string): string {
  const lastDotIndex = text.lastIndexOf('.');
  const afterLastDot = text.substring(lastDotIndex + 1);

  if (afterLastDot.length !== 2) {
    return text.replace(/\./g, '');
  }

  const integerPart = text.substring(0, lastDotIndex).replace(/\./g, '');
  return integerPart + '.' + afterLastDot;
}

function normalizeSingleComma(text: string): string {
  const commaIndex = text.lastIndexOf(',');
  const afterComma = text.substring(commaIndex + 1);

  if (/^\d{1,3}$/.test(afterComma)) {
    return text.replace(',', '.');
  }

  return text.replace(/,/g, '');
}

function normalizeMixedSeparators(text: string): string {
  const lastDotIndex = text.lastIndexOf('.');
  const lastCommaIndex = text.lastIndexOf(',');

  if (lastDotIndex > lastCommaIndex) {
    return buildDecimalString(text, lastDotIndex, /,/g);
  }

  return buildDecimalString(text, lastCommaIndex, /\./g);
}

function buildDecimalString(
  text: string,
  separatorIndex: number,
  thousandsPattern: RegExp,
): string {
  const integerPart = text.substring(0, separatorIndex).replace(thousandsPattern, '');
  const decimalPart = text.substring(separatorIndex + 1);
  return integerPart + '.' + decimalPart;
}

function stripNonNumericCostCharacters(text: string): string {
  if (text.match(/^[0-9]+[,.][0-9]{3}$/)) {
    return text.replace(/[,.]/, '').replace(/[^\d.]/g, '');
  }

  return text.replace(/[^\d.]/g, '');
}

function collapseExtraDecimalPoints(text: string): string {
  const parts = text.split('.');

  if (parts.length <= 2) {
    return text;
  }

  const integerPart = parts.slice(0, -1).join('');
  const decimalPart = parts[parts.length - 1];
  return integerPart + '.' + decimalPart;
}

function parsePreparedCostValue(normalizedText: string, isNegative: boolean): number | null {
  const value = parseFloat(normalizedText);

  if (Number.isNaN(value)) {
    return null;
  }

  return isNegative ? -value : value;
}
