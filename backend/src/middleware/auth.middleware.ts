import { Request, Response, NextFunction } from 'express';
import jwt, { Secret } from 'jsonwebtoken';
import { AnalyticsService, AnalyticsEventType } from '../services/analytics.service';

export interface AuthRequest extends Request {
  userId?: number;
  userRole?: string;
  user?: {
    id: number;
    role: string;
  };
}

export interface TokenPayload extends jwt.JwtPayload {
  userId: number;
  role: string;
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  // Test environment bypass
  if (process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true') {
    req.user = { id: 1, role: 'Manager' }; // Mock user
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

  // Check for valid token with current secret, and if that fails, check with old secret for rotation
  let decodedToken: TokenPayload | string;

  // First try with the current JWT secret
  try {
    decodedToken = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret') as TokenPayload;
  } catch (_err) {
    // If current secret fails, try with old secret (for rotation period)
    if (process.env.JWT_SECRET_OLD) {
      try {
        decodedToken = jwt.verify(token, process.env.JWT_SECRET_OLD) as TokenPayload;
      } catch (_rotationErr) {
        // Both secrets failed, return unauthorized
        // Track invalid token attempt
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
    } else {
      // Only current secret was available and it failed
      // Track invalid token attempt
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

  // Now that we've verified, we can safely access the properties
  req.userId = decodedToken.userId;
  req.userRole = decodedToken.role;
  req.user = {
    id: decodedToken.userId,
    role: decodedToken.role,
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
    metadata: { path: req.path, method: req.method, role: decodedToken.role },
  });

  next();
};

// Function to generate a JWT token with configurable expiration
export const generateToken = (userId: number, role: string, expiresIn: string | number = '24h'): string => {
  const secret = process.env.JWT_SECRET || 'your_jwt_secret';
  return jwt.sign({ userId, role }, secret, {
    expiresIn: expiresIn as any,
  });
};

export const requireManager = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.userRole !== 'Manager') {
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
