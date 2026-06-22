export const MARKDOWN_WINDOWS = {
  markdown1: { level: 1, minDays: 61, maxDays: 90 },
  markdown2: { level: 2, minDays: 31, maxDays: 60 },
  markdown3: { level: 3, minDays: 0, maxDays: 30 },
  totalMarkdown: { minDays: 0, maxDays: 90 },
  nextMonthMarkdown: { minDays: 91, maxDays: 120 },
  activeExpiryStock: { minDays: 0 },
} as const;

export type MarkdownLevel = 1 | 2 | 3;

export function getMarkdownLevelForDays(daysToExpiry: number | null): MarkdownLevel | null {
  if (daysToExpiry === null || daysToExpiry < MARKDOWN_WINDOWS.markdown3.minDays) {
    return null;
  }
  if (daysToExpiry <= MARKDOWN_WINDOWS.markdown3.maxDays) {
    return MARKDOWN_WINDOWS.markdown3.level;
  }
  if (daysToExpiry <= MARKDOWN_WINDOWS.markdown2.maxDays) {
    return MARKDOWN_WINDOWS.markdown2.level;
  }
  if (daysToExpiry <= MARKDOWN_WINDOWS.markdown1.maxDays) {
    return MARKDOWN_WINDOWS.markdown1.level;
  }
  return null;
}
