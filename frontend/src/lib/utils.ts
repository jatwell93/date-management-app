import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isWithinMarkdownPeriod(
  expiryDateString: string,
  months: number,
): boolean {
  const expiryDate = new Date(expiryDateString);
  const currentDate = new Date();
  const threeMonthsFromNow = new Date();
  threeMonthsFromNow.setMonth(currentDate.getMonth() + months);

  // Check if expiryDate is in the future and within the next 'months' months
  return expiryDate > currentDate && expiryDate <= threeMonthsFromNow;
}

export function calculateMarkdownPrice(
  originalPrice: number,
  markdownPercentage: number,
): number {
  if (markdownPercentage < 0 || markdownPercentage > 100) {
    throw new Error("Markdown percentage must be between 0 and 100.");
  }
  const discount = originalPrice * (markdownPercentage / 100);
  return originalPrice - discount;
}
