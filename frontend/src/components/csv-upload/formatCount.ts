const countFormatter = new Intl.NumberFormat('en-AU');

/** Formats an import row/product count with en-AU digit grouping (1,234). */
export const formatCount = (value: number): string => countFormatter.format(value);
