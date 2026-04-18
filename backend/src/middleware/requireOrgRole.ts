import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import {
  ROLES,
  RoleValue,
  isValidRole,
  normalizeRole,
  hasPermission,
  hasEqualOrHigherRole,
  PermissionValue,
} from '../constants/roles';
import { AnalyticsService, AnalyticsEventType } from '../services/analytics.service';

/**
 * Middleware: require the authenticated user to have one of the specified canonical roles.
 *
 * Usage:
 *   router.post('/invites', authenticateToken, requireOrgRole('admin'), handler);
 *   router.get('/members', authenticateToken, requireOrgRole('admin', 'manager'), handler);
 *
 * The user's role on `req.user.role` is normalized before comparison.
 * If the role is not canonical after normalization, the request is rejected.
 */
export function requireOrgRole(...allowedRoles: RoleValue[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const rawRole = req.user?.role ?? req.userRole;

    if (!rawRole) {
      trackDenial(req, 'missing_role');
      return res.status(403).json({ message: 'Access denied: No role assigned' });
    }

    const canonical = normalizeRole(rawRole);

    if (!isValidRole(canonical)) {
      trackDenial(req, 'invalid_role');
      return res.status(403).json({ message: 'Access denied: Invalid role' });
    }

    if (!allowedRoles.includes(canonical)) {
      trackDenial(req, 'insufficient_role');
      return res.status(403).json({ message: 'Access denied: Insufficient permissions' });
    }

    // Patch the request with the normalized canonical role
    if (req.user) {
      req.user.role = canonical;
    }
    if (req.userRole !== undefined) {
      req.userRole = canonical;
    }

    next();
  };
}

/**
 * Middleware: require the authenticated user to have a specific permission.
 *
 * Usage:
 *   router.post('/upload', authenticateToken, requirePermission('upload_files'), handler);
 */
export function requirePermission(permission: PermissionValue) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const rawRole = req.user?.role ?? req.userRole;

    if (!rawRole) {
      trackDenial(req, 'missing_role');
      return res.status(403).json({ message: 'Access denied: No role assigned' });
    }

    const canonical = normalizeRole(rawRole);

    if (!hasPermission(canonical, permission)) {
      trackDenial(req, `missing_permission_${permission}`);
      return res.status(403).json({ message: 'Access denied: Insufficient permissions' });
    }

    // Patch the request with the normalized canonical role
    if (req.user) {
      req.user.role = canonical;
    }
    if (req.userRole !== undefined) {
      req.userRole = canonical;
    }

    next();
  };
}

/**
 * Middleware: require at least the given minimum role level.
 *
 * Usage:
 *   router.post('/upload', authenticateToken, requireMinRole('manager'), handler);
 *   // Allows admin and manager, blocks team_member
 */
export function requireMinRole(minimumRole: RoleValue) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const rawRole = req.user?.role ?? req.userRole;

    if (!rawRole) {
      trackDenial(req, 'missing_role');
      return res.status(403).json({ message: 'Access denied: No role assigned' });
    }

    const canonical = normalizeRole(rawRole);

    if (!hasEqualOrHigherRole(canonical, minimumRole)) {
      trackDenial(req, 'insufficient_role_level');
      return res.status(403).json({ message: 'Access denied: Insufficient permissions' });
    }

    if (req.user) {
      req.user.role = canonical;
    }
    if (req.userRole !== undefined) {
      req.userRole = canonical;
    }

    next();
  };
}

function trackDenial(req: AuthRequest, action: string): void {
  try {
    const analyticsService = AnalyticsService.getInstance();
    analyticsService.trackEvent({
      userId: req.userId,
      eventType: AnalyticsEventType.FEATURE_ACCESS_DENIED,
      eventCategory: 'Auth',
      eventAction: action,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || undefined,
      metadata: { path: req.path, method: req.method, role: req.userRole },
    });
  } catch {
    // Analytics failure should not block the response
  }
}
