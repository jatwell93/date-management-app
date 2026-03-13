/**
 * CSV Utilities
 *
 * Shared utilities for CSV generation and processing.
 */

export function escapeCSVValue(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function stringifyCSV(
  headers: string[],
  rows: Record<string, string | number | Date | null>[],
): string {
  if (rows.length === 0) return headers.join(',');

  const escapeValue = (value: string | number | Date | null | undefined) => escapeCSVValue(value);

  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escapeValue(row[h])).join(',')),
  ];
  return lines.join('\n');
}
