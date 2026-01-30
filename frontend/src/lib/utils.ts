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
  // Apply markdown rules based on days to expiry (from feature requirements)
  if (daysToExpiry <= 30) {
    return costPrice * 0.8; // 20% markdown
  } else if (daysToExpiry <= 60) {
    return costPrice; // No markdown
  } else if (daysToExpiry <= 90) {
    return costPrice * 1.2; // 20% markup
  } else {
    return costPrice; // No markdown if outside the window
  }
}

export function calculateMarkdownPercentage(daysToExpiry: number): number {
  if (daysToExpiry <= 30) {
    return -20;
  } else if (daysToExpiry <= 60) {
    return 0;
  } else if (daysToExpiry <= 90) {
    return 20;
  } else {
    return 0;
  }
}
