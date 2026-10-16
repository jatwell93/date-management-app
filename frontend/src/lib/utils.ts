import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  calculateMarkdownPriceFromCost,
  getMarkdownDiscountPercentageForDays,
} from '@shared/markdown';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Whole calendar days from today to a `YYYY-MM-DD` expiry date, in the user's local zone.
 * `new Date('YYYY-MM-DD')` parses as UTC midnight, so subtracting `now` made an item
 * expiring today look one day away until the local time passed the UTC offset.
 */
export function calendarDaysUntil(expiryDate: string, now: Date = new Date()): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiryDate);
  const expiry = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(expiryDate);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((expiry.getTime() - today.getTime()) / MS_PER_DAY);
}

export function isWithinMarkdownPeriod(expiryDate: string | null, days: number): boolean {
  if (!expiryDate) return false;
  return calendarDaysUntil(expiryDate) <= days;
}

export function calculateMarkdownPrice(costPrice: number, daysToExpiry: number): number {
  return calculateMarkdownPriceFromCost(costPrice, daysToExpiry);
}

export function calculateMarkdownPercentage(daysToExpiry: number): number {
  return getMarkdownDiscountPercentageForDays(daysToExpiry);
}
