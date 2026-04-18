/**
 * CORS Middleware for Cloudflare Workers
 *
 * Handles Cross-Origin Resource Sharing (CORS) headers for production deployment.
 */

import { Env } from '../types/env';
import { ExpressRequest, ExpressResponse, ExpressMiddleware } from '../express-adapter';

/**
 * CORS configuration
 */
interface CorsOptions {
  origin: string | string[];
  credentials: boolean;
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  maxAge?: number;
}

/**
 * Create CORS middleware
 */
export function createCorsMiddleware(options: CorsOptions): ExpressMiddleware {
  return async (req: ExpressRequest, res: ExpressResponse, next: () => void) => {
    const requestOrigin = (req.get('Origin') || req.get('Referer') || '').trim();

    // Determine if origin is allowed
    let allowedOrigin = '';

    if (typeof options.origin === 'string') {
      // If origin is '*', allow all
      if (options.origin === '*') {
        allowedOrigin = requestOrigin || '*';
      } else {
        allowedOrigin = options.origin;
      }
    } else if (Array.isArray(options.origin)) {
      // If no request origin, don't set CORS header (will fail safely)
      if (!requestOrigin) {
        allowedOrigin = '';
      } else {
        try {
          const originUrl = new URL(requestOrigin);
          const isAllowed = options.origin.some((allowed) => {
            try {
              const allowedUrl = new URL(allowed);
              return originUrl.origin === allowedUrl.origin;
            } catch {
              // If allowed origin can't be parsed as URL, do string comparison
              return requestOrigin === allowed;
            }
          });
          allowedOrigin = isAllowed ? requestOrigin : '';
        } catch (error) {
          // If request origin can't be parsed, try direct string match
          const isAllowed = options.origin.some((allowed) => requestOrigin === allowed);
          allowedOrigin = isAllowed ? requestOrigin : '';
        }
      }
    }

    // Set CORS headers
    if (allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    }

    if (options.credentials && allowedOrigin !== '*') {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    if (options.methods) {
      res.setHeader('Access-Control-Allow-Methods', options.methods.join(', '));
    }

    if (options.allowedHeaders) {
      res.setHeader('Access-Control-Allow-Headers', options.allowedHeaders.join(', '));
    }

    if (options.exposedHeaders) {
      res.setHeader('Access-Control-Expose-Headers', options.exposedHeaders.join(', '));
    }

    if (options.maxAge) {
      res.setHeader('Access-Control-Max-Age', options.maxAge.toString());
    }

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    next();
  };
}

/**
 * Production CORS configuration
 */
export function createProductionCors(env: Env): ExpressMiddleware {
  // For development/testing: Allow all origins
  // In production with real domain, restrict to specific domains
  const allowAll = env.NODE_ENV !== 'production' || !env.FRONTEND_URL;

  return createCorsMiddleware({
    origin: allowAll
      ? '*'
      : [
          'http://localhost:3000',
          'http://localhost:3001',
          'http://127.0.0.1:3000',
          'http://127.0.0.1:3001',
          'http://127.0.0.1:3002',
          'https://d412d559.date-management-status.pages.dev',
          'https://date-management-status.pages.dev',
          ...(env.FRONTEND_URL ? [env.FRONTEND_URL] : []),
        ],
    credentials: !allowAll, // Only send credentials if not allowing all origins
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Length', 'X-Request-Id'],
    maxAge: 86400, // 24 hours
  });
}
