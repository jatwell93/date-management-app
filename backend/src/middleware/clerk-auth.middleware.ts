import { Request, Response, NextFunction } from 'express';
import { createClerkClient, verifyToken } from '@clerk/backend';
import { envConfig } from '../config/environment';
import { getAuthorizedParties } from '../utils/authorized-parties';

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

interface ClerkUserIdentity {
  email?: string;
  username?: string;
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

async function getClerkUserIdentity(userId: string): Promise<ClerkUserIdentity> {
  const clerkClient = createClerkClient({ secretKey: envConfig.CLERK_SECRET_KEY });
  const user = await clerkClient.users.getUser(userId);

  return {
    email: user.primaryEmailAddress?.emailAddress,
    username: user.username ?? undefined,
  };
}

async function resolveClerkIdentity(decoded: ClerkTokenPayload): Promise<ClerkUserIdentity> {
  if (decoded.email) {
    return {
      email: decoded.email,
      username: decoded.username,
    };
  }

  return getClerkUserIdentity(decoded.sub);
}

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

    const identity = await resolveClerkIdentity(decoded);

    // Attach Clerk user context to request
    req.auth = {
      userId: decoded.sub,
      email: identity.email,
      username: identity.username,
      organizationId: decoded.org_id,
    };

    // Backwards compatibility
    req.userId = decoded.sub;
    req.userEmail = identity.email;

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

    const identity = await resolveClerkIdentity(decoded);

    req.auth = {
      userId: decoded.sub,
      email: identity.email,
      username: identity.username,
      organizationId: decoded.org_id,
    };
  } catch (error) {
    console.error('Clerk token verification failed (optional auth)', error);
    // Don't fail - allow request to proceed without auth context
  }

  next();
};
