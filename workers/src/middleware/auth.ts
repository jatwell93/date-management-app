/**
 * JWT Authentication Middleware for Cloudflare Workers
 * Task 7: Workers Edge Security
 *
 * Validates JWT tokens at the edge before routing to backend API.
 * Uses jose library for JWT verification with HS256 algorithm.
 */

import { jwtVerify, SignJWT, JWTPayload } from 'jose';
import { normalizeRole, RoleValue } from '../constants/roles';

/**
 * JWT Payload interface
 */
export interface JWTPayloadData extends JWTPayload {
  userId: number;
  organizationId: string;
  email?: string;
  role?: string;
}

/**
 * Public endpoints that don't require JWT validation
 * Task 7.6: Define public endpoints
 */
const PUBLIC_ENDPOINTS = [
  '/auth/login',
  '/auth/register',
  '/health',
  '/health/check',
  '/organization/bootstrap',
];

/**
 * Check if endpoint is public (doesn't require authentication)
 */
export function isPublicEndpoint(pathname: string): boolean {
  return PUBLIC_ENDPOINTS.some((endpoint) => {
    const apiPrefixed = endpoint.startsWith('/api') ? endpoint : `/api${endpoint}`;
    return (
      pathname === endpoint ||
      pathname.startsWith(endpoint) ||
      pathname === apiPrefixed ||
      pathname.startsWith(apiPrefixed)
    );
  });
}

/**
 * Extract JWT from Authorization header
 * Task 7.2: Extract JWT from Authorization: Bearer <token> header
 *
 * @param authHeader - Authorization header value
 * @returns JWT token or null
 */
function extractToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.slice(7); // Remove "Bearer " prefix
}

/**
 * Verify JWT token signature
 * Task 7.3: Verify JWT signature using secret
 *
 * @param token - JWT token to verify
 * @param secret - JWT secret for verification
 * @returns Decoded JWT payload or null if invalid
 */
export async function verifyJWT(token: string, secret: string): Promise<JWTPayloadData | null> {
  try {
    const encoder = new TextEncoder();
    const secretKey = encoder.encode(secret);

    // Add 5-minute clock skew tolerance for exp validation
    const { payload } = await jwtVerify(token, secretKey, {
      clockTolerance: 5 * 60, // 5 minutes in seconds
    });

    return payload as JWTPayloadData;
  } catch (error) {
    // Token is invalid, expired, or signature doesn't match
    // Log the error type for debugging (don't expose details to client)
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if ((globalThis as { DEBUG?: boolean }).DEBUG) {
      console.error('JWT verification failed:', errorMsg);
    }

    return null;
  }
}

/**
 * Create a signed JWT token
 * Used for login/register endpoints to issue tokens
 *
 * @param userId - User ID to encode in token
 * @param organizationId - Organization ID for multi-tenant security
 * @param secret - JWT secret for signing
 * @param expiresIn - Expiration time (default: 24h)
 * @returns Signed JWT token
 */
export async function createJWT(
  userId: number,
  organizationId: string,
  secret: string,
  expiresIn: string = '24h',
): Promise<string> {
  const encoder = new TextEncoder();
  const secretKey = encoder.encode(secret);

  return await new SignJWT({ userId, organizationId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expiresIn)
    .setIssuedAt()
    .sign(secretKey);
}

/**
 * Authenticate request with JWT
 * Task 7.1: Create JWT middleware
 * Task 7.4: Return 401 if token is missing, invalid, or expired
 *
 * @param request - Incoming request
 * @param jwtSecret - JWT secret from environment
 * @returns Object with userId and error if authentication fails
 */
export async function authenticateRequest(
  request: Request,
  jwtSecret: string,
): Promise<{
  authenticated: boolean;
  userId?: number;
  organizationId?: string;
  role?: RoleValue;
  error?: string;
}> {
  const authHeader = request.headers.get('Authorization');
  const token = extractToken(authHeader);

  if (!token) {
    return {
      authenticated: false,
      error: 'Missing or malformed Authorization header',
    };
  }

  const payload = await verifyJWT(token, jwtSecret);

  if (!payload) {
    return {
      authenticated: false,
      error: 'Invalid or expired JWT token',
    };
  }

  if (!payload.userId) {
    return {
      authenticated: false,
      error: 'Invalid token: missing userId',
    };
  }

  if (!payload.organizationId) {
    return {
      authenticated: false,
      error: 'Invalid token: missing organizationId',
    };
  }

  return {
    authenticated: true,
    userId: payload.userId,
    organizationId: payload.organizationId,
    role: payload.role ? normalizeRole(payload.role) : undefined,
  };
}

/**
 * JWT authentication middleware factory
 * Returns middleware function for edge authentication
 *
 * Usage:
 * ```typescript
 * const authMiddleware = createAuthMiddleware(env.JWT_SECRET);
 * const result = await authMiddleware(request, { pathname });
 * ```
 */
export function createAuthMiddleware(jwtSecret: string) {
  return async (
    request: Request,
    context: { pathname: string },
  ): Promise<{
    authenticated: boolean;
    userId?: number;
    organizationId?: string;
    shouldBypass: boolean;
  }> => {
    const { pathname } = context;

    // Task 7.6: Skip validation for public endpoints
    if (isPublicEndpoint(pathname)) {
      return { authenticated: true, shouldBypass: true };
    }

    // Authenticate protected endpoint
    const result = await authenticateRequest(request, jwtSecret);

    return {
      authenticated: result.authenticated,
      userId: result.userId,
      organizationId: result.organizationId,
      shouldBypass: false,
    };
  };
}

/**
 * Add authenticated user ID to request headers
 * Task 7.5: Pass validated user ID to backend in x-user-id header
 *
 * @param request - Original request
 * @param userId - Authenticated user ID
 * @returns New request with x-user-id header added
 */
export function addUserIdHeader(request: Request, userId: number): Request {
  const headers = new Headers(request.headers);
  headers.set('x-user-id', String(userId));

  return new Request(request, { headers });
}

/**
 * Create 401 Unauthorized response
 * Task 7.4: Return 401 for invalid/missing tokens
 */
export function unauthorized(message: string = 'Unauthorized'): Response {
  return new Response(
    JSON.stringify({
      code: 'UNAUTHORIZED',
      message,
      timestamp: new Date().toISOString(),
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer realm="API"',
      },
    },
  );
}

/**
 * Create 403 Forbidden response
 */
export function forbidden(message: string = 'Forbidden'): Response {
  return new Response(
    JSON.stringify({
      code: 'FORBIDDEN',
      message,
      timestamp: new Date().toISOString(),
    }),
    {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

/**
 * Public endpoint list getter (for documentation)
 */
export function getPublicEndpoints(): string[] {
  return [...PUBLIC_ENDPOINTS];
}
