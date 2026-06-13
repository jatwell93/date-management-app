import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isWithinMarkdownPeriod(expiryDate: string | null, days: number): boolean {
  if (!expiryDate) return false;
  const now = new Date();
  const expiry = new Date(expiryDate);
  const daysToExpiry = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return daysToExpiry <= days;
}

export function calculateMarkdownPrice(costPrice: number, daysToExpiry: number): number {
  const markdownPercentage = calculateMarkdownPercentage(daysToExpiry);
  return costPrice * (1 - markdownPercentage / 100);
}

export function calculateMarkdownPercentage(daysToExpiry: number): number {
  if (daysToExpiry <= 30) {
    return 75;
  } else if (daysToExpiry <= 60) {
    return 60;
  } else if (daysToExpiry <= 90) {
    return 50;
  } else {
    return 0;
  }
}
