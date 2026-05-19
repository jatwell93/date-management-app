/**
 * Multi-Tenant Auth Context & Subscription Validation
 * Phase 8B Task 1: Auth Context Extraction
 *
 * Provides multi-tenant security layer for Cloudflare Workers:
 * 1. Extract organizationId from JWT payload
 * 2. Validate organization status is 'active'
 * 3. Query and cache subscription tier from Neon
 *
 * This module extends the basic JWT verification in middleware/auth.ts
 * with organization context and subscription tier validation.
 */

import { jwtVerify, JWTPayload } from 'jose';
import {
  TierLevel,
  SubscriptionStatus,
  TIER_LIMITS,
  AVAILABLE_FEATURES,
} from '../../../shared/types/subscription';

/**
 * Task 8B.1: JWT Token Payload with Multi-Tenant Context
 */
export interface TokenPayload extends JWTPayload {
  userId: number;
  role?: string;
  organizationId: string;
  tierLevel?: TierLevel;
  exp?: number;
}

/**
 * Task 8B.1: Auth Context Object Injected into Request
 */
export interface AuthContext {
  userId: number;
  organizationId: string;
  tierLevel: TierLevel;
  subscription: SubscriptionTierData;
  isValid: boolean;
  error?: string;
}

// Re-export types for convenience
export type { TierLevel };
export { SubscriptionStatus, TIER_LIMITS, AVAILABLE_FEATURES };

/**
 * Subscription tier data from database
 */
export interface SubscriptionTierData {
  id: string;
  organizationId: string;
  tierLevel: TierLevel;
  status: SubscriptionStatus;
  createdAt: Date;
  updatedAt: Date;
  stripeSubscriptionId?: string;
  trialEndDate?: Date;
}

/**
 * Type guard for TierLevel
 */
export function isTierLevel(value: string): value is TierLevel {
  return ['starter', 'professional', 'premium', 'concierge'].includes(value);
}

/**
 * Type guard for SubscriptionStatus
 */
export function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return Object.values(SubscriptionStatus).includes(value as SubscriptionStatus);
}

/**
 * Task 8B.1.2: Verify JWT token signature and extract payload
 * Uses jose for cryptographic verification
 *
 * @param token - JWT token to verify
 * @param secret - JWT secret/key for verification
 * @returns TokenPayload if valid, null if invalid or expired
 */
export async function verifyJWT(token: string, secret: string): Promise<TokenPayload | null> {
  try {
    const encoder = new TextEncoder();
    const secretKey = encoder.encode(secret);

    const { payload } = await jwtVerify(token, secretKey);

    return payload as TokenPayload;
  } catch (error) {
    // Token is invalid, expired, or signature doesn't match
    // Log error (console works in Cloudflare Workers)
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Auth] JWT verification failed:', errorMsg);
    return null;
  }
}

/**
 * Task 8B.1.3: Extract organizationId from JWT token
 * Guard against malformed tokens
 *
 * @param token - Decoded JWT payload
 * @returns organizationId string or null if missing
 */
export function extractOrganizationId(token: TokenPayload | null): string | null {
  if (!token) {
    return null;
  }

  if (typeof token.organizationId !== 'string' || !token.organizationId) {
    return null;
  }

  return token.organizationId;
}

/**
 * Task 8B.1.4: Query SubscriptionTier from Neon database
 * Uses @neondatabase/serverless for edge-safe database access
 *
 * @param organizationId - Organization ID to look up
 * @param dbClient - Database client from Hyperdrive binding
 * @returns SubscriptionTierData or null if not found
 */
export async function querySubscriptionTier(
  organizationId: string,
  dbClient: any, // SQL query client from @neondatabase/serverless
): Promise<SubscriptionTierData | null> {
  try {
    // Parameterized query to prevent SQL injection
    const result = await dbClient`
      SELECT
        id,
        "organizationId",
        "tierLevel",
        status,
        "createdAt",
        "updatedAt",
        "stripeSubscriptionId",
        "trialEndDate"
      FROM "SubscriptionTier"
      WHERE "organizationId" = ${organizationId}
      ORDER BY "createdAt" DESC
      LIMIT 1
    `;

    if (!result || result.length === 0) {
      return null;
    }

    const row = result[0];

    // Type validation
    if (!isTierLevel(row.tierLevel) || !isSubscriptionStatus(row.status)) {
      console.error('[Auth] Invalid subscription tier data for org', organizationId, row);
      return null;
    }

    return {
      id: row.id,
      organizationId: row.organizationId,
      tierLevel: row.tierLevel as TierLevel,
      status: row.status as SubscriptionStatus,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      stripeSubscriptionId: row.stripeSubscriptionId,
      trialEndDate: row.trialEndDate ? new Date(row.trialEndDate) : undefined,
    };
  } catch (error) {
    console.error('[Auth] Failed to query subscription tier:', error);
    return null;
  }
}

/**
 * Task 8B.1.5: Validate organization status is 'active'
 * Check for canceled subscriptions
 *
 * @param subscription - Subscription tier data
 * @param organizationId - Organization ID for logging
 * @returns { isValid: boolean, error?: string }
 */
export function validateOrganizationStatus(
  subscription: SubscriptionTierData | null,
  organizationId: string,
): { isValid: boolean; error?: string } {
  if (!subscription) {
    return {
      isValid: false,
      error: `No subscription found for organization ${organizationId}`,
    };
  }

  // Check if subscription is inactive/canceled
  if (subscription.status === SubscriptionStatus.CANCELED) {
    return {
      isValid: false,
      error: 'Organization subscription has been canceled. Please contact support.',
    };
  }

  // Status is active, trialing, or past_due (all allowed for MVP phase)
  return { isValid: true };
}

/**
 * Task 8B.1.6: Create auth middleware wrapper for Workers
 * Orchestrates JWT verification, org extraction, subscription validation
 *
 * @param token - JWT token from Authorization header
 * @param jwtSecret - JWT secret from environment
 * @param dbClient - Database client from Hyperdrive binding
 * @returns AuthContext if valid, with isValid=false and error if invalid
 */
export async function authenticateWorkerRequest(
  token: string | null,
  jwtSecret: string,
  dbClient: any,
): Promise<AuthContext> {
  // Step 1: Check token provided
  if (!token) {
    return {
      userId: 0,
      organizationId: '',
      tierLevel: 'starter',
      subscription: {} as SubscriptionTierData,
      isValid: false,
      error: 'Unauthorized: No token provided',
    };
  }

  // Step 2: Verify JWT signature
  const decodedToken = await verifyJWT(token, jwtSecret);
  if (!decodedToken) {
    return {
      userId: 0,
      organizationId: '',
      tierLevel: 'starter',
      subscription: {} as SubscriptionTierData,
      isValid: false,
      error: 'Access denied: Invalid or expired token',
    };
  }

  // Step 3: Extract organizationId
  const organizationId = extractOrganizationId(decodedToken);
  if (!organizationId) {
    return {
      userId: 0,
      organizationId: '',
      tierLevel: 'starter',
      subscription: {} as SubscriptionTierData,
      isValid: false,
      error: 'Access denied: Missing tenant context in token',
    };
  }

  // Step 4: Query and validate subscription tier
  const subscription = await querySubscriptionTier(organizationId, dbClient);
  const statusValidation = validateOrganizationStatus(subscription, organizationId);

  if (!statusValidation.isValid || !subscription) {
    return {
      userId: decodedToken.userId,
      organizationId,
      tierLevel: 'starter',
      subscription: {} as SubscriptionTierData,
      isValid: false,
      error: statusValidation.error,
    };
  }

  // All validations passed
  return {
    userId: decodedToken.userId,
    organizationId,
    tierLevel: subscription.tierLevel,
    subscription,
    isValid: true,
  };
}

/**
 * Task 8B.1.6: Extract JWT token from Authorization header
 * Handles "Bearer <token>" format
 *
 * @param request - HTTP request object
 * @returns JWT token string or null
 */
export function extractJWTFromHeader(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  // Return null for empty token (e.g., "Bearer " with no token)
  const token = parts[1];
  return token ? token : null;
}
