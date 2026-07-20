import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  calculateMarkdownPriceFromCost,
  getMarkdownDiscountPercentageForDays,
} from '@shared/markdown';

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
  return calculateMarkdownPriceFromCost(costPrice, daysToExpiry);
}

export function calculateMarkdownPercentage(daysToExpiry: number): number {
  return getMarkdownDiscountPercentageForDays(daysToExpiry);
}
