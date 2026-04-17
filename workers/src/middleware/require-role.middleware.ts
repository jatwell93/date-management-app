/**
 * Role-based authorization middleware for Cloudflare Workers.
 *
 * Enforces canonical role checks on protected endpoints (e.g. uploads).
 * Must run AFTER the JWT auth middleware so that req.userRole is populated.
 */

import { ExpressRequest, ExpressResponse, ExpressMiddleware } from '../express-adapter';
import { RoleValue, normalizeRole, canUpload } from '../constants/roles';

/**
 * Middleware: require the authenticated user to have one of the specified roles.
 *
 * Usage inside createRouter():
 *   router.use(createRequireRoleMiddleware(['admin', 'manager'], ['/api/uploads']));
 */
export function createRequireRoleMiddleware(
  allowedRoles: readonly RoleValue[],
  protectedPathPrefixes: string[],
): ExpressMiddleware {
  return (req: ExpressRequest, res: ExpressResponse, next: () => void) => {
    const isProtected = protectedPathPrefixes.some(
      (prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`),
    );

    if (!isProtected) {
      return next();
    }

    // Only gate write operations (POST/PUT/PATCH/DELETE)
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }

    const rawRole = req.userRole ?? req.user?.role;

    if (!rawRole) {
      res.status(403);
      res.json({
        code: 'FORBIDDEN',
        message: 'Access denied: No role assigned',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const canonical = normalizeRole(rawRole);

    if (!allowedRoles.includes(canonical)) {
      res.status(403);
      res.json({
        code: 'FORBIDDEN',
        message: 'Insufficient permissions for this operation. Contact your organization admin.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Patch canonical role onto request
    req.userRole = canonical;
    if (req.user) {
      req.user.role = canonical;
    }

    return next();
  };
}

/**
 * Convenience: middleware that gates upload endpoints to roles with upload permission.
 */
export function createUploadRoleMiddleware(): ExpressMiddleware {
  return (req: ExpressRequest, res: ExpressResponse, next: () => void) => {
    // Only gate upload-related paths
    if (!req.path.includes('/upload')) {
      return next();
    }

    // Only gate write operations
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }

    const rawRole = req.userRole ?? req.user?.role;

    if (!rawRole) {
      res.status(403);
      res.json({
        code: 'FORBIDDEN',
        message: 'Access denied: No role assigned',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const canonical = normalizeRole(rawRole);

    if (!canUpload(canonical)) {
      res.status(403);
      res.json({
        code: 'FORBIDDEN',
        message: 'Insufficient permissions for upload. Contact your organization admin.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.userRole = canonical;
    if (req.user) {
      req.user.role = canonical;
    }

    return next();
  };
}
