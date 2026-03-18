import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '@clerk/backend';
import { envConfig } from '../config/environment';

const CLERK_DEV_ORIGINS = ['http://localhost:3002', 'http://127.0.0.1:3002'];

function getAuthorizedParties(): string[] {
  const partySet = new Set<string>(CLERK_DEV_ORIGINS);

  if (envConfig.FRONTEND_URL) {
    partySet.add(envConfig.FRONTEND_URL);
  }

  if (envConfig.CORS_ORIGIN) {
    partySet.add(envConfig.CORS_ORIGIN);
  }

  const parties = Array.from(partySet);
  if (parties.length === CLERK_DEV_ORIGINS.length && process.env.NODE_ENV === 'production') {
    console.warn(
      'WARNING: No production origins configured for Clerk token verification. Please set FRONTEND_URL or CORS_ORIGIN.',
    );
  }

  return parties;
}

/**
 * Clerk JWT Token Claims
 * Clerk tokens contain these standard claims plus custom metadata
 */
export interface ClerkTokenPayload {
  sub: string; // Clerk user ID (user_xxx)
  email?: string;
  username?: string;
  // Custom metadata from Clerk (if passed during signup)
  org_id?: string;
  // Standard JWT claims
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

/**
 * Extended Request with Clerk user context
 */
export interface ClerkAuthRequest extends Request {
  auth: {
    userId: string; // Clerk user ID (user_xxx)
    email?: string;
    username?: string;
    organizationId?: string;
  };
  userId?: string; // Backwards compatibility
  userEmail?: string;
  username?: string;
}

/**
 * Type helper for using clerkAuth middleware with Express RequestHandler
 * Avoids unsafe 'as unknown as RequestHandler' casting
 */
import type { RequestHandler } from 'express';
export type ClerkAuthHandler = RequestHandler;

/**
 * Clerk Authentication Middleware
 * Verifies Clerk JWT tokens and attaches user context to request
 *
 * Usage: router.get('/protected', clerkAuth, yourController)
 */
export const clerkAuth = async (req: ClerkAuthRequest, res: Response, next: NextFunction) => {
  // Test bypass for unit tests
  if (process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true') {
    req.auth = {
      userId: 'user_test_123',
      email: 'test@example.com',
      username: 'testuser',
      organizationId: 'org_test_123',
    };
    req.userId = req.auth.userId;
    req.userEmail = req.auth.email;
    return next();
  }

  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    if (!envConfig.CLERK_SECRET_KEY) {
      console.error('CLERK_SECRET_KEY not configured. Clerk authentication unavailable.');
      return res.status(500).json({ error: 'Auth service not configured' });
    }

    // Verify Clerk token
    const decoded = (await verifyToken(token, {
      secretKey: envConfig.CLERK_SECRET_KEY,
      authorizedParties: getAuthorizedParties(),
    })) as unknown as ClerkTokenPayload;

    // Attach Clerk user context to request
    req.auth = {
      userId: decoded.sub,
      email: decoded.email,
      username: decoded.username,
      organizationId: decoded.org_id,
    };

    // Backwards compatibility
    req.userId = decoded.sub;
    req.userEmail = decoded.email;

    next();
  } catch (error) {
    console.error(
      'Clerk token verification failed:',
      error instanceof Error ? error.message : error,
    );
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    return res.status(401).json({
      error: 'Invalid or expired token',
    });
  }
};

/**
 * Optional Clerk Auth Middleware
 * Verifies Clerk JWT if present, but allows unsigned requests
 * Useful for endpoints that have public + authenticated modes
 */
export const clerkAuthOptional = async (
  req: ClerkAuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // No token provided - continue without auth context
    return next();
  }

  try {
    const token = authHeader.substring(7);
    const decoded = (await verifyToken(token, {
      secretKey: envConfig.CLERK_SECRET_KEY,
      authorizedParties: getAuthorizedParties(),
    })) as unknown as ClerkTokenPayload;

    req.auth = {
      userId: decoded.sub,
      email: decoded.email,
      username: decoded.username,
      organizationId: decoded.org_id,
    };
  } catch (error) {
    console.error('Clerk token verification failed (optional auth)', error);
    // Don't fail - allow request to proceed without auth context
  }

  next();
};
