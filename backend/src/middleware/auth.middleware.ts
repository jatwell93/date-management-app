import { Request, Response, NextFunction } from 'express';
import jwt, { Secret } from 'jsonwebtoken';
import { verifyToken as verifyClerkToken } from '@clerk/backend';
import { AnalyticsService, AnalyticsEventType } from '../services/analytics.service';
import { BillingCycle, TierLevel, SubscriptionStatus } from '../types/subscription';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { envConfig } from '../config/environment';
import { SubscriptionService } from '../services/subscription.service';

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
  tierLevel: TierLevel;
}

interface ClerkTokenPayload {
  sub: string;
  exp?: number;
}

const CLERK_DEV_ORIGINS = ['http://localhost:3002', 'http://127.0.0.1:3002'];

function getAuthorizedParties(): string[] {
  const partySet = new Set<string>(CLERK_DEV_ORIGINS);

  if (envConfig.FRONTEND_URL) {
    partySet.add(envConfig.FRONTEND_URL);
  }

  if (envConfig.CORS_ORIGIN) {
    partySet.add(envConfig.CORS_ORIGIN);
  }

  return Array.from(partySet);
}

const isTierLevel = (value: string): value is TierLevel =>
  ['starter', 'professional', 'premium', 'concierge'].includes(value as TierLevel);

const isBillingCycle = (value: string): value is BillingCycle =>
  Object.values(BillingCycle).includes(value as BillingCycle);

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  // Test environment bypass
  if (process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true') {
    req.user = {
      id: 1,
      role: 'Manager',
      organizationId: 'default-org',
      tierLevel: 'professional',
    };
    req.userId = 1;
    req.userRole = 'Manager';
    req.organizationId = 'default-org';
    req.tierLevel = 'professional';
    return next();
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token === undefined || token === null) {
    // Track unauthorized access attempt
    const analyticsService = AnalyticsService.getInstance();
    analyticsService.trackEvent({
      eventType: AnalyticsEventType.USER_LOGOUT,
      eventCategory: 'Auth',
      eventAction: 'unauthorized_access_attempt',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || undefined,
      metadata: { path: req.path, method: req.method },
    });

    return res.status(401).json({ message: 'Access denied: No token provided' }); // No token
  }

  // Check for valid token with current secret and old secret.
  // If both fail, fall back to Clerk JWT verification for migrated clients.
  let decodedToken: TokenPayload | string | null = null;

  const resolveFromClerkToken = async (): Promise<TokenPayload | null> => {
    if (!envConfig.CLERK_SECRET_KEY) {
      return null;
    }

    try {
      const clerkDecoded = (await verifyClerkToken(token, {
        secretKey: envConfig.CLERK_SECRET_KEY,
        authorizedParties: getAuthorizedParties(),
      })) as ClerkTokenPayload;

      const prisma = getDefaultDatabaseClient();

      const user = await prisma.user.findUnique({
        where: { clerkUserId: clerkDecoded.sub },
        select: {
          id: true,
          role: true,
          organizationId: true,
        },
      });

      if (!user?.organizationId) {
        return null;
      }

      const subscription = await prisma.subscriptionTier.findFirst({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: 'desc' },
      });

      if (!subscription) {
        return null;
      }

      const normalizedTier = subscription.tierLevel.toLowerCase();
      if (!isTierLevel(normalizedTier)) {
        return null;
      }

      return {
        userId: user.id,
        role: user.role,
        organizationId: user.organizationId,
        tierLevel: normalizedTier,
        exp: clerkDecoded.exp,
      };
    } catch {
      return null;
    }
  };

  // First try with the current JWT secret
  try {
    decodedToken = jwt.verify(token, envConfig.JWT_SECRET) as TokenPayload;
  } catch (_err) {
    // If current secret fails, try with old secret (for rotation period)
    if (process.env.JWT_SECRET_OLD) {
      try {
        decodedToken = jwt.verify(token, process.env.JWT_SECRET_OLD) as TokenPayload;
      } catch (_rotationErr) {
        decodedToken = await resolveFromClerkToken();
      }
    } else {
      decodedToken = await resolveFromClerkToken();
    }

    if (!decodedToken) {
      // JWT verification failed and Clerk fallback also failed.
      // Track invalid token attempt.
      const analyticsService = AnalyticsService.getInstance();
      analyticsService.trackEvent({
        eventType: AnalyticsEventType.USER_LOGOUT,
        eventCategory: 'Auth',
        eventAction: 'invalid_token_attempt',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent') || undefined,
        metadata: { path: req.path, method: req.method },
      });

      return res.status(403).json({ message: 'Access denied: Invalid token' });
    }
  }

  // FIX: Add a check to ensure the decoded token payload exists and is an object
  if (!decodedToken || typeof decodedToken === 'string') {
    // Track invalid token payload
    const analyticsService = AnalyticsService.getInstance();
    analyticsService.trackEvent({
      eventType: AnalyticsEventType.USER_LOGOUT,
      eventCategory: 'Auth',
      eventAction: 'invalid_token_payload',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || undefined,
      metadata: { path: req.path, method: req.method },
    });

    return res.status(403).json({ message: 'Access denied: Invalid token payload' }); // Token is valid, but payload is missing or in wrong format
  }

  // Check for token expiration (manually if not automatically handled by jwt.verify)
  if (decodedToken.exp && decodedToken.exp * 1000 < Date.now()) {
    // Track expired token attempt
    const analyticsService = AnalyticsService.getInstance();
    analyticsService.trackEvent({
      eventType: AnalyticsEventType.USER_LOGOUT,
      eventCategory: 'Auth',
      eventAction: 'expired_token_attempt',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || undefined,
      metadata: { path: req.path, method: req.method },
    });

    return res.status(403).json({ message: 'Access denied: Token has expired' });
  }

  // Validate required multi-tenant fields
  if (!decodedToken.organizationId || !decodedToken.tierLevel) {
    const analyticsService = AnalyticsService.getInstance();
    analyticsService.trackEvent({
      eventType: AnalyticsEventType.USER_LOGOUT,
      eventCategory: 'Auth',
      eventAction: 'missing_tenant_context',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || undefined,
      metadata: { path: req.path, method: req.method },
    });

    return res.status(403).json({ message: 'Access denied: Missing tenant context in token' });
  }

  // Validate organization exists and is active (task 4.4)
  try {
    const prisma = getDefaultDatabaseClient();
    const subscription = await prisma.subscriptionTier.findFirst({
      where: { organizationId: decodedToken.organizationId },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      const analyticsService = AnalyticsService.getInstance();
      analyticsService.trackEvent({
        userId: decodedToken.userId,
        eventType: AnalyticsEventType.USER_LOGOUT,
        eventCategory: 'Auth',
        eventAction: 'organization_subscription_not_found',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent') || undefined,
        metadata: {
          organizationId: decodedToken.organizationId,
          path: req.path,
          method: req.method,
        },
      });

      return res.status(403).json({
        message: 'Access denied: Organization subscription not configured',
      });
    }

    // Check if subscription is canceled (allow access until Stripe period end if applicable)
    if (subscription.status === SubscriptionStatus.CANCELED) {
      const tierLevel = isTierLevel(subscription.tierLevel) ? subscription.tierLevel : null;
      const billingCycle = isBillingCycle(subscription.billingCycle)
        ? subscription.billingCycle
        : null;

      if (!tierLevel || !billingCycle) {
        const analyticsService = AnalyticsService.getInstance();
        analyticsService.trackEvent({
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

        return res.status(403).json({
          message: 'Access denied: Organization subscription is invalid. Please contact support.',
        });
      }

      const subscriptionService = new SubscriptionService(prisma);
      const hasActiveAccess = await subscriptionService.isAccessActive({
        id: subscription.id,
        organizationId: subscription.organizationId,
        tierLevel,
        stripeSubscriptionId: subscription.stripeSubscriptionId ?? undefined,
        trialEndDate: subscription.trialEndDate ?? undefined,
        status: subscription.status,
        billingCycle,
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt,
      });

      if (!hasActiveAccess) {
        const analyticsService = AnalyticsService.getInstance();
        analyticsService.trackEvent({
          userId: decodedToken.userId,
          eventType: AnalyticsEventType.USER_LOGOUT,
          eventCategory: 'Auth',
          eventAction: 'organization_subscription_canceled',
          ipAddress: req.ip,
          userAgent: req.get('User-Agent') || undefined,
          metadata: {
            organizationId: decodedToken.organizationId,
            path: req.path,
            method: req.method,
          },
        });

        return res.status(403).json({
          message:
            'Access denied: Organization subscription has been canceled. Please contact support.',
        });
      }
    }
  } catch (error) {
    const analyticsService = AnalyticsService.getInstance();
    analyticsService.trackEvent({
      userId: decodedToken.userId,
      eventType: AnalyticsEventType.USER_LOGOUT,
      eventCategory: 'Auth',
      eventAction: 'organization_validation_error',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || undefined,
      metadata: {
        organizationId: decodedToken.organizationId,
        path: req.path,
        method: req.method,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    return res.status(500).json({
      message: 'Error validating organization access',
    });
  }

  // Now that we've verified, we can safely access the properties
  req.userId = decodedToken.userId;
  req.userRole = decodedToken.role;
  req.organizationId = decodedToken.organizationId;
  req.tierLevel = decodedToken.tierLevel;
  req.user = {
    id: decodedToken.userId,
    role: decodedToken.role,
    organizationId: decodedToken.organizationId,
    tierLevel: decodedToken.tierLevel,
  };

  // Track successful authenticated request
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

  next();
};

// Function to generate a JWT token with configurable expiration
export const generateToken = (
  userId: number,
  role: string,
  organizationId: string,
  tierLevel: TierLevel,
  expiresIn: string | number = '24h',
): string => {
  return jwt.sign({ userId, role, organizationId, tierLevel }, envConfig.JWT_SECRET, {
    expiresIn: expiresIn as any,
  });
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
