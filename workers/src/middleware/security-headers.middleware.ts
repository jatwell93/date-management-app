/**
 * Security Headers Middleware for Cloudflare Workers
 * 
 * Implements Content Security Policy (CSP) and other critical security headers
 * Phase 20 Security Hardening - addresses security audit findings
 * 
 * Reference: docs/security-audit.md section 7.2 "CORS & CSP"
 * Reference: PHASE-20-SESSION-2-SUMMARY.md - CSP implementation
 */

import { Env } from '../types/env';
import { ExpressRequest, ExpressResponse, ExpressMiddleware } from '../express-adapter';

/**
 * Content Security Policy (CSP) configuration
 * 
 * SECURITY CRITICAL (Phase 20 - Security Audit Finding):
 * - Prevents XSS attacks by restricting script and style sources
 * - Restricts form submissions to same origin
 * - Restricts frame embedding of content
 * - Disallows eval() and inline scripts
 * 
 * Finding: CSP headers not configured (MEDIUM PRIORITY)
 * Impact: XSS attacks possible on frontend
 * Solution: Add CSP headers with restrictive directives
 */
export const CSP_DIRECTIVES = {
  // Default source for all content types not covered by other directives
  'default-src': ["'self'"],

  // JavaScript source restrictions
  'script-src': [
    "'self'",
    // Allow Cloudflare's own scripts
    'https://cdn.jsdelivr.net',
    // Allow for analytics/monitoring if configured
    'https://cdn.segment.com'
  ],

  // CSS source restrictions
  'style-src': [
    "'self'",
    "'unsafe-inline'", // Required for styled-components
    'https://fonts.googleapis.com',
    'https://cdn.jsdelivr.net'
  ],

  // Font source restrictions
  'font-src': [
    "'self'",
    'https://fonts.gstatic.com',
    'data:' // Allow base64 encoded fonts
  ],

  // Image source restrictions
  'img-src': [
    "'self'",
    'https:',
    'data:' // Allow inline data images
  ],

  // Form submission restrictions
  'form-action': ["'self'"],

  // Frame embedding restrictions - prevents clickjacking
  'frame-ancestors': ["'none'"],

  // Restricts the origins to which the document can navigate (except links)
  'base-uri': ["'self'"],

  // Restricts the origins that can embed this document as a frame
  'frame-src': ["'none'"],

  // Restricts plugin types
  'object-src': ["'none'"],

  // Restricts data submission
  'connect-src': [
    "'self'",
    // Backend API
    'https://api.date-management-app.com',
    // Stripe for payments
    'https://api.stripe.com',
    'https://m.stripe.com',
    // Cloudflare services
    'https://*.cloudflare.com',
    // Allow WebSocket for development
    'ws:',
    'wss:',
    // Sentry for error tracking
    'https://sentry.io',
    // Analytics
    'https://cdn.segment.com'
  ],

  // Restricts media (audio/video) sources
  'media-src': ["'self'", 'https:'],

  // Restricts child frame (iframe) content
  'child-src': ["'self'"],

  // Restricts manifests
  'manifest-src': ["'self'"],

  // Required for service workers
  'worker-src': ["'self'"],

  // Upgrade insecure requests to HTTPS (in production)
  'upgrade-insecure-requests': []
};

/**
 * Other security headers
 */
export const SECURITY_HEADERS = {
  // Prevents browsers from MIME-sniffing a response away from the declared Content-Type
  'X-Content-Type-Options': 'nosniff',

  // Prevents the page from being displayed in a frame, reducing clickjacking attacks
  'X-Frame-Options': 'DENY',

  // Enables XSS protection in older browsers
  'X-XSS-Protection': '1; mode=block',

  // Referrer Policy - limits referrer information
  'Referrer-Policy': 'strict-origin-when-cross-origin',

  // Permissions Policy (formerly Feature Policy) - restricts browser features
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',

  // Strict Transport Security - forces HTTPS
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

/**
 * Format CSP directives into a header string
 */
function formatCSP(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([key, values]) => {
      if (values.length === 0) {
        return key;
      }
      return `${key} ${values.join(' ')}`;
    })
    .join('; ');
}

/**
 * Create security headers middleware
 */
export function createSecurityHeadersMiddleware(env: Env): ExpressMiddleware {
  return (req: ExpressRequest, res: ExpressResponse, next: () => void) => {
    // Add CSP header
    const cspHeader = formatCSP(CSP_DIRECTIVES);
    res.setHeader('Content-Security-Policy', cspHeader);

    // Add other security headers
    Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    // Additional header for Cloudflare Workers
    res.setHeader('X-Powered-By', 'Cloudflare Workers');

    // Allow production override for CSP in development
    if (env.NODE_ENV === 'development') {
      // In development, log CSP violations but don't block
      res.setHeader('Content-Security-Policy-Report-Only', cspHeader);
    }

    next();
  };
}

/**
 * CSP strict mode for production
 * More restrictive than development
 */
export const PRODUCTION_CSP_DIRECTIVES = {
  // Default source for all content types not covered by other directives
  'default-src': ["'self'"],

  // JavaScript source restrictions - NO inline scripts in production
  'script-src': [
    "'self'",
    'https://cdn.jsdelivr.net',
    'https://cdn.segment.com'
  ],

  // CSS source restrictions
  'style-src': [
    "'self'",
    'https://fonts.googleapis.com',
    'https://cdn.jsdelivr.net'
  ],

  // Rest same as development
  'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
  'img-src': ["'self'", 'https:', 'data:'],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'self'"],
  'frame-src': ["'none'"],
  'object-src': ["'none'"],
  'connect-src': [
    "'self'",
    'https://api.date-management-app.com',
    'https://api.stripe.com',
    'https://m.stripe.com',
    'https://*.cloudflare.com',
    'wss:',
    'https://sentry.io',
    'https://cdn.segment.com'
  ],
  'media-src': ["'self'", 'https:'],
  'child-src': ["'self'"],
  'manifest-src': ["'self'"],
  'worker-src': ["'self'"],
  'upgrade-insecure-requests': []
};

/**
 * Create strict production security headers middleware
 */
export function createProductionSecurityHeadersMiddleware(env: Env): ExpressMiddleware {
  return (req: ExpressRequest, res: ExpressResponse, next: () => void) => {
    // In production, use strict CSP
    const directives = env.NODE_ENV === 'production' ? PRODUCTION_CSP_DIRECTIVES : CSP_DIRECTIVES;
    const cspHeader = formatCSP(directives);
    res.setHeader('Content-Security-Policy', cspHeader);

    // Add other security headers
    Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    res.setHeader('X-Powered-By', 'Cloudflare Workers');

    next();
  };
}
