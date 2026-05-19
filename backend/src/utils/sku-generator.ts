/**
 * Simple SKU generator utility
 */

import { randomBytes } from 'crypto';

export function generateSKU(prefix: string = 'SKU'): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(6).toString('hex');
  return `${prefix}-${timestamp}-${random}`.toUpperCase();
}
