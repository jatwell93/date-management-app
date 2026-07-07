import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { verifyToken as verifyClerkToken } from '@clerk/backend';
import { SubscriptionTier } from '@prisma/client';
import { AnalyticsService, AnalyticsEventType } from '../services/analytics.service';
import { BillingCycle, TierLevel, SubscriptionStatus } from '../types/subscription';
import { envConfig } from '../config/environment';
import { SubscriptionService } from '../services/subscription.service';
import { getDiContainer } from '../di/container';
import { UserRepository } from '../repositories/user.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { getAuthorizedParties } from '../utils/authorized-parties';

export interface AuthRequest extends Request {
  userId?: number;
  userRole?: string;
  organizationId?: string;
  tierLevel?: TierLevel;
  user?: {
    id: number;
    role: string;
    organizationId: string;
    tierLevel: TierLevel;
  };
}

export interface TokenPayload extends jwt.JwtPayload {
  userId: number;
  role: string;
  organizationId: string;
  tierLevel?: TierLevel;
}

interface ClerkTokenPayload {
  sub: string;
  exp?: number;
}

const TIER_VERSION_HEADER = 'X-Org-Tier-Version';

const isTierLevel = (value: string): value is TierLevel =>
  ['free', 'starter', 'professional', 'enterprise', 'premium', 'concierge'].includes(
    value as TierLevel,
  );

const isBillingCycle = (value: string): value is BillingCycle =>
  Object.values(BillingCycle).includes(value as BillingCycle);

const hasRequiredTokenFields = (token: TokenPayload | unknown): boolean => {
  return (
    typeof token === 'object' &&
    token !== null &&
    'userId' in token &&
    'role' in token &&
    'organizationId' in token
  );
};

function getTierVersion(subscription: SubscriptionTier): string {
  return `${subscription.id}:${subscription.tierLevel}:${subscription.updatedAt.getTime()}`;
}

// Export cache invalidation to allow webhooks to instantly apply tier changes
export const invalidateSubscriptionCache = (organizationId: string): void => {
  subscriptionCache.delete(organizationId);
};

// Simple memory cache for subscription status
interface CachedSubscription {
  data: SubscriptionTier | null;
  hasActiveAccess: boolean;
}
const subscriptionCache = new Map<
  string,
  { subscription: CachedSubscription; timestamp: number }
>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const TEST_AUTH_BYPASS_ORG_ID = 'default-org';

async function checkCanceledAccess(subscription: SubscriptionTier): Promise<boolean> {
  const tierLevel = isTierLevel(subscription.tierLevel) ? subscription.tierLevel : null;
  const billingCycle = isBillingCycle(subscription.billingCycle) ? subscription.billingCycle : null;
  if (!tierLevel || !billingCycle) return false;
  const subscriptionService = getDiContainer().resolve(SubscriptionService);
  return subscriptionService.isAccessActive({
    id: subscription.id,
    organizationId: subscription.organizationId,
    tierLevel,
    stripeSubscriptionId: subscription.stripeSubscriptionId ?? undefined,
    trialEndDate: subscription.trialEndDate ?? undefined,
    trialStartedAt: subscription.trialStartedAt ?? undefined,
    trialConvertedAt: subscription.trialConvertedAt ?? undefined,
    status: subscription.status as SubscriptionStatus,
    billingCycle,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
  });
}

async function getCachedOrFetchSubscription(
  orgId: string,
): Promise<{ subscription: SubscriptionTier | null; hasActiveAccess: boolean }> {
  const cached = subscriptionCache.get(orgId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { subscription: cached.subscription.data, hasActiveAccess: cached.subscription.hasActiveAccess };
  }

  const subscriptionRepository = getDiContainer().resolve(SubscriptionRepository);
  const subscription = await subscriptionRepository.findLatestByOrganizationId(orgId);

  const hasActiveAccess =
    subscription?.status === SubscriptionStatus.CANCELED
      ? await checkCanceledAccess(subscription)
      : true;

  subscriptionCache.set(orgId, {
    subscription: { data: subscription, hasActiveAccess },
    timestamp: Date.now(),
  });

  return { subscription, hasActiveAccess };
}

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  // Test environment bypass
  if (process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true') {
    return setTestAuthContext(req, next);
  }

  const token = extractTokenFromRequest(req);
  if (!token) {
    return handleAuthError(res, req, {
      message: 'Access denied: No token provided',
      action: 'unauthorized_access_attempt',
    });
  }

  const decodedToken = await verifyToken(token);
  if (!decodedToken) {
    return handleAuthError(res, req, {
      message: 'Access denied: Invalid token',
      action: 'invalid_token_attempt',
      statusCode: 403,
    });
  }

  if (!isValidTokenStructure(decodedToken)) {
    return handleAuthError(res, req, {
      message: 'Access denied: Invalid token payload',
      action: 'invalid_token_payload',
      statusCode: 403,
    });
  }

  if (!hasRequiredTokenFields(decodedToken)) {
    return handleAuthError(res, req, {
      message: 'Access denied: Malformed token payload',
      action: 'missing_token_fields',
      statusCode: 403,
    });
  }

  if (isTokenExpired(decodedToken)) {
    return handleAuthError(res, req, {
      message: 'Access denied: Token has expired',
      action: 'expired_token_attempt',
      statusCode: 403,
    });
  }

  if (!decodedToken.organizationId) {
    return handleAuthError(res, req, {
      message: 'Access denied: Missing tenant context in token',
      action: 'missing_tenant_context',
      statusCode: 403,
    });
  }

  try {
    const { dbTierLevel, tierVersion } = await validateOrganizationSubscription(decodedToken, req);
    res.setHeader(TIER_VERSION_HEADER, tierVersion);
    setRequestContext(req, decodedToken, dbTierLevel);
    trackSuccessfulAuth(decodedToken, req);
    next();
  } catch (error) {
    return handleSubscriptionError(error, res, req, decodedToken);
  }
};

/**
 * Helper functions for authentication middleware
 */

function setTestAuthContext(req: AuthRequest, next: NextFunction): void {
  req.user = {
    id: 1,
    role: 'admin',
    organizationId: TEST_AUTH_BYPASS_ORG_ID,
    tierLevel: 'professional',
  };
  req.userId = 1;
  req.userRole = 'admin';
  req.organizationId = TEST_AUTH_BYPASS_ORG_ID;
  req.tierLevel = 'professional';
  next();
}

function extractTokenFromRequest(req: AuthRequest): string | null {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;

  // Handle both string and array headers
  const headers = Array.isArray(authHeader) ? authHeader : [authHeader];

  // Extract the first valid bearer token
  for (const header of headers) {
    const token = header.split(' ')[1];
    if (token) return token;
  }

  return null;
}

async function verifyToken(token: string): Promise<TokenPayload | null> {
  // First try with the current JWT secret
  try {
    return jwt.verify(token, envConfig.JWT_SECRET, { algorithms: ['HS256'] }) as TokenPayload;
  } catch (_err) {
    // If current secret fails, try with old secret (for rotation period)
    if (process.env.JWT_SECRET_OLD) {
      try {
        return jwt.verify(token, process.env.JWT_SECRET_OLD, {
          algorithms: ['HS256'],
        }) as TokenPayload;
      } catch (_rotationErr) {
        // Fall through to Clerk verification
      }
    }

    // Try Clerk JWT verification as fallback
    return await resolveFromClerkToken(token);
  }
}

async function resolveFromClerkToken(token: string): Promise<TokenPayload | null> {
  if (!envConfig.CLERK_SECRET_KEY) {
    return null;
  }

  try {
    const clerkDecoded = (await verifyClerkToken(token, {
      secretKey: envConfig.CLERK_SECRET_KEY,
      authorizedParties: getAuthorizedParties(),
    })) as ClerkTokenPayload;

    const userRepository = getDiContainer().resolve(UserRepository);

    const user = await userRepository.findActiveByClerkUserId(clerkDecoded.sub);

    // Exclude soft-deleted users
    if (!user || user.organizationId === null) {
      return null;
    }

    return {
      userId: user.id,
      role: user.role,
      organizationId: user.organizationId,
      exp: clerkDecoded.exp,
    };
  } catch {
    return null;
  }
}

function isValidTokenStructure(decodedToken: unknown): decodedToken is TokenPayload {
  return decodedToken !== null && typeof decodedToken === 'object';
}

function isTokenExpired(decodedToken: TokenPayload): boolean {
  return decodedToken.exp ? decodedToken.exp * 1000 < Date.now() : false;
}

function handleAuthError(
  res: Response,
  req: AuthRequest,
  opts: { message: string; action: string; statusCode?: number },
): Response {
  AnalyticsService.getInstance().trackEvent({
    eventType: AnalyticsEventType.USER_LOGOUT,
    eventCategory: 'Auth',
    eventAction: opts.action,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent') || undefined,
    metadata: { path: req.path, method: req.method },
  });
  return res.status(opts.statusCode ?? 401).json({ message: opts.message });
}

function handleSubscriptionError(
  error: unknown,
  res: Response,
  req: AuthRequest,
  decodedToken: TokenPayload,
): Response {
  if (
    error instanceof Error &&
    (error.message.includes('Organization subscription not configured') ||
      error.message.includes('Organization subscription is invalid') ||
      error.message.includes('Organization subscription has been canceled'))
  ) {
    return handleAuthError(res, req, {
      message: error.message,
      action: 'organization_subscription_invalid',
      statusCode: 403,
    });
  }
  trackAuthError(decodedToken, 'organization_validation_error', error, req);
  return res.status(500).json({ message: 'Error validating organization access' });
}

async function validateOrganizationSubscription(
  decodedToken: TokenPayload,
  req: AuthRequest,
): Promise<{ dbTierLevel: TierLevel | null; tierVersion: string }> {
  const { subscription, hasActiveAccess } = await getCachedOrFetchSubscription(
    decodedToken.organizationId,
  );

  if (!subscription) {
    AnalyticsService.getInstance().trackEvent({
      userId: decodedToken.userId,
      eventType: AnalyticsEventType.USER_LOGOUT,
      eventCategory: 'Auth',
      eventAction: 'organization_subscription_not_found',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || undefined,
      metadata: { organizationId: decodedToken.organizationId, path: req.path, method: req.method },
    });
    throw new Error('Organization subscription not configured');
  }

  if (subscription.status === SubscriptionStatus.CANCELED) {
    const tierLevel = isTierLevel(subscription.tierLevel) ? subscription.tierLevel : null;
    const billingCycle = isBillingCycle(subscription.billingCycle) ? subscription.billingCycle : null;

    if (!tierLevel || !billingCycle) {
      AnalyticsService.getInstance().trackEvent({
        userId: decodedToken.userId,
        eventType: AnalyticsEventType.USER_LOGOUT,
        eventCategory: 'Auth',
        eventAction: 'organization_subscription_invalid',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent') || undefined,
        metadata: {
          organizationId: decodedToken.organizationId,
          path: req.path,
          method: req.method,
          subscriptionTierLevel: subscription.tierLevel,
          subscriptionBillingCycle: subscription.billingCycle,
        },
      });
      throw new Error('Organization subscription is invalid. Please contact support.');
    }

    if (!hasActiveAccess) {
      AnalyticsService.getInstance().trackEvent({
        userId: decodedToken.userId,
        eventType: AnalyticsEventType.USER_LOGOUT,
        eventCategory: 'Auth',
        eventAction: 'organization_subscription_canceled',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent') || undefined,
        metadata: { organizationId: decodedToken.organizationId, path: req.path, method: req.method },
      });
      throw new Error('Organization subscription has been canceled. Please contact support.');
    }
  }

  const dbTierLevel = isTierLevel(subscription.tierLevel) ? subscription.tierLevel : null;
  const tierVersion = getTierVersion(subscription);

  if (dbTierLevel && decodedToken.tierLevel && decodedToken.tierLevel !== dbTierLevel) {
    console.warn('[AUTH] Stale token tier detected; using latest DB tier', {
      userId: decodedToken.userId,
      organizationId: decodedToken.organizationId,
      tokenTierLevel: decodedToken.tierLevel,
      dbTierLevel,
      tierVersion,
    });
  }

  return { dbTierLevel, tierVersion };
}

function setRequestContext(
  req: AuthRequest,
  decodedToken: TokenPayload,
  dbTierLevel: TierLevel | null,
): void {
  req.userId = decodedToken.userId;
  req.userRole = decodedToken.role;
  req.organizationId = decodedToken.organizationId;
  req.tierLevel = dbTierLevel ?? undefined;
  req.user = {
    id: decodedToken.userId,
    role: decodedToken.role,
    organizationId: decodedToken.organizationId,
    tierLevel: dbTierLevel ?? 'free',
  };
}

function trackSuccessfulAuth(decodedToken: TokenPayload, req: AuthRequest): void {
  const analyticsService = AnalyticsService.getInstance();
  analyticsService.trackEvent({
    userId: decodedToken.userId,
    eventType: AnalyticsEventType.VIEW_DASHBOARD, // General action for accessing protected routes
    eventCategory: 'Auth',
    eventAction: 'protected_route_access',
    ipAddress: req.ip,
    userAgent: req.get('User-Agent') || undefined,
    metadata: {
      path: req.path,
      method: req.method,
      role: decodedToken.role,
      organizationId: decodedToken.organizationId,
    },
  });
}

function trackAuthError(
  decodedToken: TokenPayload,
  action: string,
  error: Error | unknown,
  req: AuthRequest,
): void {
  const analyticsService = AnalyticsService.getInstance();
  analyticsService.trackEvent({
    userId: decodedToken.userId,
    eventType: AnalyticsEventType.USER_LOGOUT,
    eventCategory: 'Auth',
    eventAction: action,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent') || undefined,
    metadata: {
      organizationId: decodedToken.organizationId,
      path: req.path,
      method: req.method,
      error: error instanceof Error ? error.message : 'Unknown error',
    },
  });
}

export interface GenerateTokenArgs {
  userId: number;
  role: string;
  organizationId: string;
  tierLevel: TierLevel;
  expiresIn?: string | number;
}

export const generateToken = ({
  userId,
  role,
  organizationId,
  tierLevel,
  expiresIn = '24h',
}: GenerateTokenArgs): string => {
  return jwt.sign(
    { userId, role, organizationId, tierLevel },
    envConfig.JWT_SECRET as string,
    { expiresIn } as jwt.SignOptions,
  );
};

export const requireManager = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.userRole !== 'Manager' && req.userRole !== 'admin') {
    // Track unauthorized manager access attempt
    const analyticsService = AnalyticsService.getInstance();
    analyticsService.trackEvent({
      userId: req.userId,
      eventType: AnalyticsEventType.USER_LOGOUT,
      eventCategory: 'Auth',
      eventAction: 'manager_access_denied',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || undefined,
      metadata: { path: req.path, method: req.method, role: req.userRole },
    });

    return res.status(403).json({ message: 'Access denied: Manager role required' });
  }
  next();
};
