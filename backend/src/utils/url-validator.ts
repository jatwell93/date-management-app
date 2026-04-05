/**
 * URL Validation Utility
 *
 * Validates redirect URLs to prevent open redirect vulnerabilities
 */

import { envConfig } from '../config/environment';

/**
 * Validate that a URL is safe for redirects
 * Ensures URLs are either relative or match allowed domains
 */
export function validateRedirectUrl(url: string, fieldName: string = 'URL'): void {
  if (!url || typeof url !== 'string') {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  // Allow relative URLs (start with /)
  if (url.startsWith('/')) {
    return;
  }

  // Parse the URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (_error) {
    throw new Error(`${fieldName} is not a valid URL: ${url}`);
  }

  // Only allow http and https protocols
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`${fieldName} must use http or https protocol`);
  }

  // Build allowed domains list
  const allowedDomains = new Set<string>();

  // Add frontend URL domain
  try {
    const frontendUrl = new URL(envConfig.FRONTEND_URL);
    allowedDomains.add(frontendUrl.hostname);
  } catch (_error) {
    // Ignore if FRONTEND_URL is not a valid URL
  }

  // Add CORS origin domain
  try {
    const corsOrigin = new URL(envConfig.CORS_ORIGIN);
    allowedDomains.add(corsOrigin.hostname);
  } catch (_error) {
    // Ignore if CORS_ORIGIN is not a valid URL
  }

  // Add localhost variants for development
  if (envConfig.NODE_ENV === 'development' || envConfig.NODE_ENV === 'test') {
    allowedDomains.add('localhost');
    allowedDomains.add('127.0.0.1');
    allowedDomains.add('[::1]');
  }

  // Check if the URL's hostname is in the allowed list
  if (!allowedDomains.has(parsedUrl.hostname)) {
    throw new Error(
      `${fieldName} domain "${parsedUrl.hostname}" is not allowed. Must be one of: ${Array.from(allowedDomains).join(', ')}`,
    );
  }
}

/**
 * Validate Stripe price ID format
 */
export function validateStripePriceId(priceId: string): void {
  if (!priceId || typeof priceId !== 'string') {
    throw new Error('priceId must be a non-empty string');
  }

  if (!priceId.startsWith('price_')) {
    throw new Error('priceId must be a valid Stripe price ID (starts with "price_")');
  }

  if (priceId.length < 10 || priceId.length > 100) {
    throw new Error('priceId has invalid length');
  }
}
