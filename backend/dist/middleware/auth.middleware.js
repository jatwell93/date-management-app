"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireManager = exports.generateToken = exports.authenticateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const analytics_service_1 = require("../services/analytics.service");
const subscription_1 = require("../types/subscription");
const database_factory_1 = require("../database/database-factory");
const authenticateToken = async (req, res, next) => {
    // Test environment bypass
    if (process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true') {
        req.user = {
            id: 1,
            role: 'Manager',
            organizationId: 'default-org',
            tierLevel: 'professional'
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
        const analyticsService = analytics_service_1.AnalyticsService.getInstance();
        analyticsService.trackEvent({
            eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
            eventCategory: 'Auth',
            eventAction: 'unauthorized_access_attempt',
            ipAddress: req.ip,
            userAgent: req.get('User-Agent') || undefined,
            metadata: { path: req.path, method: req.method },
        });
        return res.status(401).json({ message: 'Access denied: No token provided' }); // No token
    }
    // Check for valid token with current secret, and if that fails, check with old secret for rotation
    let decodedToken;
    // First try with the current JWT secret
    try {
        decodedToken = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
    }
    catch (_err) {
        // If current secret fails, try with old secret (for rotation period)
        if (process.env.JWT_SECRET_OLD) {
            try {
                decodedToken = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET_OLD);
            }
            catch (_rotationErr) {
                // Both secrets failed, return unauthorized
                // Track invalid token attempt
                const analyticsService = analytics_service_1.AnalyticsService.getInstance();
                analyticsService.trackEvent({
                    eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
                    eventCategory: 'Auth',
                    eventAction: 'invalid_token_attempt',
                    ipAddress: req.ip,
                    userAgent: req.get('User-Agent') || undefined,
                    metadata: { path: req.path, method: req.method },
                });
                return res.status(403).json({ message: 'Access denied: Invalid token' });
            }
        }
        else {
            // Only current secret was available and it failed
            // Track invalid token attempt
            const analyticsService = analytics_service_1.AnalyticsService.getInstance();
            analyticsService.trackEvent({
                eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
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
        const analyticsService = analytics_service_1.AnalyticsService.getInstance();
        analyticsService.trackEvent({
            eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
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
        const analyticsService = analytics_service_1.AnalyticsService.getInstance();
        analyticsService.trackEvent({
            eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
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
        const analyticsService = analytics_service_1.AnalyticsService.getInstance();
        analyticsService.trackEvent({
            eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
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
        const prisma = (0, database_factory_1.getDefaultDatabaseClient)();
        const subscription = await prisma.subscriptionTier.findFirst({
            where: { organizationId: decodedToken.organizationId },
            orderBy: { createdAt: 'desc' },
        });
        if (!subscription) {
            const analyticsService = analytics_service_1.AnalyticsService.getInstance();
            analyticsService.trackEvent({
                userId: decodedToken.userId,
                eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
                eventCategory: 'Auth',
                eventAction: 'organization_subscription_not_found',
                ipAddress: req.ip,
                userAgent: req.get('User-Agent') || undefined,
                metadata: {
                    organizationId: decodedToken.organizationId,
                    path: req.path,
                    method: req.method
                },
            });
            return res.status(403).json({
                message: 'Access denied: Organization subscription not configured'
            });
        }
        // Check if subscription is canceled
        if (subscription.status === subscription_1.SubscriptionStatus.CANCELED) {
            const analyticsService = analytics_service_1.AnalyticsService.getInstance();
            analyticsService.trackEvent({
                userId: decodedToken.userId,
                eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
                eventCategory: 'Auth',
                eventAction: 'organization_subscription_canceled',
                ipAddress: req.ip,
                userAgent: req.get('User-Agent') || undefined,
                metadata: {
                    organizationId: decodedToken.organizationId,
                    path: req.path,
                    method: req.method
                },
            });
            return res.status(403).json({
                message: 'Access denied: Organization subscription has been canceled. Please contact support.'
            });
        }
    }
    catch (error) {
        const analyticsService = analytics_service_1.AnalyticsService.getInstance();
        analyticsService.trackEvent({
            userId: decodedToken.userId,
            eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
            eventCategory: 'Auth',
            eventAction: 'organization_validation_error',
            ipAddress: req.ip,
            userAgent: req.get('User-Agent') || undefined,
            metadata: {
                organizationId: decodedToken.organizationId,
                path: req.path,
                method: req.method,
                error: error instanceof Error ? error.message : 'Unknown error'
            },
        });
        return res.status(500).json({
            message: 'Error validating organization access'
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
    const analyticsService = analytics_service_1.AnalyticsService.getInstance();
    analyticsService.trackEvent({
        userId: decodedToken.userId,
        eventType: analytics_service_1.AnalyticsEventType.VIEW_DASHBOARD, // General action for accessing protected routes
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
exports.authenticateToken = authenticateToken;
// Function to generate a JWT token with configurable expiration
const generateToken = (userId, role, organizationId, tierLevel, expiresIn = '24h') => {
    const secret = process.env.JWT_SECRET || 'your_jwt_secret';
    return jsonwebtoken_1.default.sign({ userId, role, organizationId, tierLevel }, secret, {
        expiresIn: expiresIn,
    });
};
exports.generateToken = generateToken;
const requireManager = (req, res, next) => {
    if (req.userRole !== 'Manager') {
        // Track unauthorized manager access attempt
        const analyticsService = analytics_service_1.AnalyticsService.getInstance();
        analyticsService.trackEvent({
            userId: req.userId,
            eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
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
exports.requireManager = requireManager;
