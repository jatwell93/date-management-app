import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { Logger } from '../utils/logger';
import * as Sentry from '@sentry/node';
import { AnalyticsService } from '../services/analytics.service';

/**
 * Middleware to detect and log cross-tenant access attempts
 * This middleware should be applied AFTER auth middleware to ensure
 * the user's organizationId is available
 */
export const detectCrossTenantAccess = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (shouldSkipTenantCheck(req.path)) {
    return next();
  }

  // Get the user's organization from the authenticated request
  const userOrganizationId = req.organizationId;
  const userId = req.userId;

  // Extract organization ID from the request if present
  const resourceOrganizationId = extractOrganizationIdFromRequest(req);

  // If we have both IDs and they don't match, log the cross-tenant access attempt
  if (
    userOrganizationId &&
    resourceOrganizationId &&
    userOrganizationId !== resourceOrganizationId
  ) {
    handleCrossTenantViolation(req, userOrganizationId, resourceOrganizationId, userId);
  }

  next();
};

/**
 * Check if the path should be skipped for tenant checks
 */
function shouldSkipTenantCheck(path: string): boolean {
  const skipPaths = [
    '/api/health',
    '/api/webhooks/stripe', // Only skip Stripe webhook endpoint
    '/api/public',
  ];
  return skipPaths.some((p) => path.startsWith(p));
}

/**
 * Handle and log cross-tenant access violation
 */
function handleCrossTenantViolation(
  req: Request,
  userOrganizationId: string,
  resourceOrganizationId: string,
  userId?: number,
) {
  const crossTenantContext = {
    userId,
    userOrganizationId,
    resourceOrganizationId,
    resource: req.path,
    method: req.method,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    correlationId: req.headers['x-correlation-id'],
    timestamp: new Date().toISOString(),
  };

  // Log the security violation
  Logger.warn('Cross-tenant access attempt detected', crossTenantContext);

  // Send to Sentry as security issue
  Sentry.captureMessage('Cross-tenant access attempt', {
    level: 'warning',
    tags: {
      type: 'security',
      severity: 'medium',
    },
    extra: crossTenantContext,
  });

  // Track in analytics for conversion opportunities
  const analyticsService = AnalyticsService.getInstance();
  analyticsService.trackEvent({
    userId,
    eventType: AnalyticsEventType.CROSS_TENANT_ACCESS_ATTEMPT,
    eventCategory: 'Security',
    eventAction: 'cross_tenant_attempt',
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    metadata: {
      userOrganizationId,
      resourceOrganizationId,
      resource: req.path,
      method: req.method,
    },
  });
}

/**
 * Extract organization ID from various parts of the request
 */
function extractOrganizationIdFromRequest(req: Request): string | null {
  return getFromParams(req) || getFromQuery(req) || getFromBody(req);
}

function getFromParams(req: Request): string | null {
  return req.params?.organizationId || req.params?.orgId || null;
}

function getFromQuery(req: Request): string | null {
  const orgId = req.query?.organizationId;
  if (!orgId) return null;
  return Array.isArray(orgId) ? (orgId[0] as string) : (orgId as string);
}

function getFromBody(req: Request): string | null {
  if (!req.body) return null;
  return (
    req.body.organizationId ||
    req.body.data?.organizationId ||
    req.body.filter?.organizationId ||
    null
  );
}

/**
 * Middleware to validate tenant access at the service level
 * This should be used in individual controllers/services when they have
 * the full context of the resource being accessed
 */
export const validateTenantAccess = (
  resourceOrgId: string,
  userOrgId: string,
  context: {
    userId?: number;
    resource?: string;
    action?: string;
  },
) => {
  if (!isAccessAllowed(resourceOrgId, userOrgId)) {
    handleTenantAccessViolation(resourceOrgId, userOrgId, context);
  }
};

function isAccessAllowed(resourceOrgId: string, userOrgId: string): boolean {
  // If either ID is missing, we can't validate, so we proceed (or handle elsewhere)
  // Access is allowed if IDs match
  return !resourceOrgId || !userOrgId || resourceOrgId === userOrgId;
}

function handleTenantAccessViolation(
  resourceOrgId: string,
  userOrgId: string,
  context: Record<string, any>,
) {
  const violationContext = {
    ...context,
    resourceOrganizationId: resourceOrgId,
    userOrganizationId: userOrgId,
    timestamp: new Date().toISOString(),
  };

  Logger.error('Tenant access violation at service layer', violationContext);

  Sentry.captureMessage('Tenant access violation', {
    level: 'error',
    tags: {
      type: 'security',
      severity: 'high',
    },
    extra: violationContext,
  });

  throw new Error('Access denied: Resource belongs to a different organization');
}
