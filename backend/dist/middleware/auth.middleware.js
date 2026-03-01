"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireManager = exports.generateToken = exports.authenticateToken = exports.TEST_AUTH_BYPASS_ORG_ID = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const backend_1 = require("@clerk/backend");
const analytics_service_1 = require("../services/analytics.service");
const subscription_1 = require("../types/subscription");
const database_factory_1 = require("../database/database-factory");
const environment_1 = require("../config/environment");
const subscription_service_1 = require("../services/subscription.service");
const CLERK_DEV_ORIGINS = ['http://localhost:3002', 'http://127.0.0.1:3002'];
function getAuthorizedParties() {
    const partySet = new Set(CLERK_DEV_ORIGINS);
    if (environment_1.envConfig.FRONTEND_URL) {
        partySet.add(environment_1.envConfig.FRONTEND_URL);
    }
    if (environment_1.envConfig.CORS_ORIGIN) {
        partySet.add(environment_1.envConfig.CORS_ORIGIN);
    }
    const parties = Array.from(partySet);
    if (parties.length === CLERK_DEV_ORIGINS.length && process.env.NODE_ENV === 'production') {
        console.warn('WARNING: No production origins configured for Clerk token verification. Please set FRONTEND_URL or CORS_ORIGIN.');
    }
    return parties;
}
const isTierLevel = (value) => ['starter', 'professional', 'premium', 'concierge'].includes(value);
const isBillingCycle = (value) => Object.values(subscription_1.BillingCycle).includes(value);
const hasRequiredTokenFields = (token) => {
    return 'userId' in token && 'role' in token && 'organizationId' in token && 'tierLevel' in token;
};
// Simple memory cache for subscription status
const subscriptionCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
exports.TEST_AUTH_BYPASS_ORG_ID = 'default-org';
const authenticateToken = async (req, res, next) => {
    // Test environment bypass
    if (process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true') {
        req.user = {
            id: 1,
            role: 'Manager',
            organizationId: exports.TEST_AUTH_BYPASS_ORG_ID,
            tierLevel: 'professional',
        };
        req.userId = 1;
        req.userRole = 'Manager';
        req.organizationId = exports.TEST_AUTH_BYPASS_ORG_ID;
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
    // Check for valid token with current secret and old secret.
    // If both fail, fall back to Clerk JWT verification for migrated clients.
    let decodedToken = null;
    const resolveFromClerkToken = async () => {
        if (!environment_1.envConfig.CLERK_SECRET_KEY) {
            return null;
        }
        try {
            const clerkDecoded = (await (0, backend_1.verifyToken)(token, {
                secretKey: environment_1.envConfig.CLERK_SECRET_KEY,
                authorizedParties: getAuthorizedParties(),
            }));
            const prisma = (0, database_factory_1.getDefaultDatabaseClient)();
            const user = await prisma.user.findUnique({
                where: { clerkUserId: clerkDecoded.sub, deletedAt: null },
                select: {
                    id: true,
                    role: true,
                    organizationId: true,
                },
            });
            // Exclude soft-deleted users
            if (!user || user.organizationId === null) {
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
        }
        catch {
            return null;
        }
    };
    // First try with the current JWT secret
    try {
        decodedToken = jsonwebtoken_1.default.verify(token, environment_1.envConfig.JWT_SECRET);
    }
    catch (_err) {
        // If current secret fails, try with old secret (for rotation period)
        if (process.env.JWT_SECRET_OLD) {
            try {
                decodedToken = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET_OLD);
            }
            catch (_rotationErr) {
                decodedToken = await resolveFromClerkToken();
            }
        }
        else {
            decodedToken = await resolveFromClerkToken();
        }
        if (!decodedToken) {
            // JWT verification failed and Clerk fallback also failed.
            // Track invalid token attempt.
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
    // Check for expected object structure
    if (!decodedToken || typeof decodedToken !== 'object') {
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
        return res.status(403).json({ message: 'Access denied: Invalid token payload' });
    }
    // Validate required fields exist in the token payload
    if (!hasRequiredTokenFields(decodedToken)) {
        const analyticsService = analytics_service_1.AnalyticsService.getInstance();
        analyticsService.trackEvent({
            eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
            eventCategory: 'Auth',
            eventAction: 'missing_token_fields',
            ipAddress: req.ip,
            userAgent: req.get('User-Agent') || undefined,
            metadata: { path: req.path, method: req.method },
        });
        return res.status(403).json({ message: 'Access denied: Malformed token payload' });
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
        const orgId = decodedToken.organizationId;
        let subscription = null;
        let hasActiveAccess = true;
        // Check cache first
        const cached = subscriptionCache.get(orgId);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
            subscription = cached.subscription.data;
            hasActiveAccess = cached.subscription.hasActiveAccess;
        }
        else {
            const prisma = (0, database_factory_1.getDefaultDatabaseClient)();
            subscription = await prisma.subscriptionTier.findFirst({
                where: { organizationId: orgId },
                orderBy: { createdAt: 'desc' },
            });
            if (subscription && subscription.status === subscription_1.SubscriptionStatus.CANCELED) {
                const tierLevel = isTierLevel(subscription.tierLevel) ? subscription.tierLevel : null;
                const billingCycle = isBillingCycle(subscription.billingCycle)
                    ? subscription.billingCycle
                    : null;
                if (tierLevel && billingCycle) {
                    const subscriptionService = new subscription_service_1.SubscriptionService(prisma);
                    hasActiveAccess = await subscriptionService.isAccessActive({
                        id: subscription.id,
                        organizationId: subscription.organizationId,
                        tierLevel,
                        stripeSubscriptionId: subscription.stripeSubscriptionId ?? undefined,
                        trialEndDate: subscription.trialEndDate ?? undefined,
                        trialStartedAt: subscription.trialStartedAt ?? undefined,
                        trialConvertedAt: subscription.trialConvertedAt ?? undefined,
                        status: subscription.status,
                        billingCycle,
                        createdAt: subscription.createdAt,
                        updatedAt: subscription.updatedAt,
                    });
                }
                else {
                    hasActiveAccess = false;
                }
            }
            // Update cache
            subscriptionCache.set(orgId, {
                subscription: { data: subscription, hasActiveAccess },
                timestamp: Date.now(),
            });
        }
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
                    method: req.method,
                },
            });
            return res.status(403).json({
                message: 'Access denied: Organization subscription not configured',
            });
        }
        // Check if subscription is canceled (allow access until Stripe period end if applicable)
        if (subscription.status === subscription_1.SubscriptionStatus.CANCELED) {
            const tierLevel = isTierLevel(subscription.tierLevel) ? subscription.tierLevel : null;
            const billingCycle = isBillingCycle(subscription.billingCycle)
                ? subscription.billingCycle
                : null;
            if (!tierLevel || !billingCycle) {
                const analyticsService = analytics_service_1.AnalyticsService.getInstance();
                analyticsService.trackEvent({
                    userId: decodedToken.userId,
                    eventType: analytics_service_1.AnalyticsEventType.USER_LOGOUT,
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
            if (!hasActiveAccess) {
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
                        method: req.method,
                    },
                });
                return res.status(403).json({
                    message: 'Access denied: Organization subscription has been canceled. Please contact support.',
                });
            }
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
    return jsonwebtoken_1.default.sign({ userId, role, organizationId, tierLevel }, environment_1.envConfig.JWT_SECRET, {
        expiresIn: expiresIn,
    });
};
exports.generateToken = generateToken;
const requireManager = (req, res, next) => {
    if (req.userRole !== 'Manager' && req.userRole !== 'admin') {
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
